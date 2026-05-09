import { useState, useCallback, useRef } from "react";
import "./App.css";

const COLS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
const ROWS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// pull all cell refs like A1, B3, J10 out of a formula string
function extractDeps(formula) {
  const matches = formula.match(/[A-J]([1-9]|10)/g);
  return matches ? [...new Set(matches)] : [];
}

// topological sort using Kahn's algorithm
// returns sorted order or null if cycle detected
function topoSort(cells, depGraph) {
  // depGraph[cell] = list of cells it depends ON
  // we want eval order so dependencies come first

  const inDegree = {};
  const revDeps = {}; // revDeps[A] = cells that depend on A

  for (const cell of cells) {
    if (inDegree[cell] === undefined) inDegree[cell] = 0;
    if (!revDeps[cell]) revDeps[cell] = [];
  }

  for (const cell of cells) {
    const deps = depGraph[cell] || [];
    for (const dep of deps) {
      if (!revDeps[dep]) revDeps[dep] = [];
      revDeps[dep].push(cell);
      inDegree[cell] = (inDegree[cell] || 0);
    }
  }

  // recalculate in-degree properly
  for (const cell of cells) {
    inDegree[cell] = (depGraph[cell] || []).length;
  }

  const queue = cells.filter((c) => inDegree[c] === 0);
  const result = [];

  while (queue.length > 0) {
    const node = queue.shift();
    result.push(node);
    for (const dependent of revDeps[node] || []) {
      inDegree[dependent]--;
      if (inDegree[dependent] === 0) queue.push(dependent);
    }
  }

  if (result.length !== cells.length) return null; // cycle exists
  return result;
}

// evaluate one formula given current cell values
function evalFormula(formula, cellValues) {
  // replace cell refs with their numeric values
  let expr = formula.slice(1); // strip the '='

  // get all refs in the formula
  const refs = extractDeps(formula);

  for (const ref of refs) {
    const val = cellValues[ref];
    if (val === "#CIRCULAR" || val === "#ERROR") {
      return val; // propagate errors
    }
    const num = parseFloat(val);
    if (isNaN(num) && val !== "" && val !== undefined) {
      return "#ERROR"; // referenced cell has non-numeric text
    }
    const replacement = isNaN(num) ? 0 : num;
    // replace all occurrences of this ref in the expr
    expr = expr.replace(new RegExp(`\\b${ref}\\b`, "g"), replacement);
  }

  try {
    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${expr})`)();
    if (!isFinite(result)) return "#ERROR";
    return String(result);
  } catch {
    return "#ERROR";
  }
}

// main recalc function - given all cell raw values, compute all display values
function recalcAll(rawValues) {
  const allCells = [];
  for (const col of COLS) {
    for (const row of ROWS) {
      allCells.push(col + row);
    }
  }

  // build dependency graph
  const depGraph = {}; // depGraph[cell] = cells this cell depends on
  for (const cell of allCells) {
    const raw = rawValues[cell] || "";
    if (raw.startsWith("=")) {
      depGraph[cell] = extractDeps(raw);
    } else {
      depGraph[cell] = [];
    }
  }

  // topo sort
  const order = topoSort(allCells, depGraph);

  const computed = {};

  if (order === null) {
    // global cycle - mark all formula cells that are in a cycle
    // we need to figure out which cells are actually cyclic
    // simple approach: try to find which cells form cycles
    for (const cell of allCells) {
      const raw = rawValues[cell] || "";
      if (!raw.startsWith("=")) {
        computed[cell] = raw;
      } else {
        computed[cell] = "#CIRCULAR";
      }
    }
    // refine: only cells that are actually in cycles get #CIRCULAR
    // re-do with individual checks
    return refineCircular(rawValues, depGraph, allCells);
  }

  for (const cell of order) {
    const raw = rawValues[cell] || "";
    if (!raw.startsWith("=")) {
      computed[cell] = raw;
    } else {
      computed[cell] = evalFormula(raw, computed);
    }
  }

  return computed;
}

// detect which cells are actually cyclic vs just error-propagating
function refineCircular(rawValues, depGraph, allCells) {
  // find cells in cycles using DFS
  const inCycle = new Set();

  function hasCycle(cell, visited, stack) {
    visited.add(cell);
    stack.add(cell);
    for (const dep of depGraph[cell] || []) {
      if (!visited.has(dep)) {
        if (hasCycle(dep, visited, stack)) return true;
      } else if (stack.has(dep)) {
        return true;
      }
    }
    stack.delete(cell);
    return false;
  }

  // find all cells participating in any cycle
  function findCyclicCells() {
    // track which cells can reach themselves
    for (const cell of allCells) {
      const visited = new Set();
      const stack = new Set();
      // check if cell is in a cycle
      function dfs(c) {
        if (stack.has(c)) {
          return true;
        }
        if (visited.has(c)) return false;
        visited.add(c);
        stack.add(c);
        for (const dep of depGraph[c] || []) {
          if (dfs(dep)) {
            inCycle.add(c);
            return true;
          }
        }
        stack.delete(c);
        return false;
      }
      dfs(cell);
    }
  }

  findCyclicCells();

  // now do a partial topo sort ignoring cyclic cells
  const safeCells = allCells.filter((c) => !inCycle.has(c));
  const safeDepGraph = {};
  for (const cell of safeCells) {
    safeDepGraph[cell] = (depGraph[cell] || []).filter((d) => !inCycle.has(d));
  }

  const order = topoSort(safeCells, safeDepGraph);
  const computed = {};

  // mark cyclic cells
  for (const cell of inCycle) {
    computed[cell] = "#CIRCULAR";
  }

  if (order) {
    for (const cell of order) {
      const raw = rawValues[cell] || "";
      if (!raw.startsWith("=")) {
        computed[cell] = raw;
      } else {
        computed[cell] = evalFormula(raw, computed);
      }
    }
  }

  return computed;
}

// ---- React Component ----

export default function App() {
  // raw: what user typed, computed: what to display
  const [rawValues, setRawValues] = useState({});
  const [computed, setComputed] = useState({});

  // which cell is currently being edited
  const [activeCell, setActiveCell] = useState(null);
  const [editValue, setEditValue] = useState("");

  // undo/redo stacks - store snapshots of rawValues
  const undoStack = useRef([]);
  const redoStack = useRef([]);

  const applyChange = useCallback(
    (newRaw) => {
      // push current state to undo stack before applying
      undoStack.current.push({ ...rawValues });
      redoStack.current = []; // clear redo on new change

      setRawValues(newRaw);
      setComputed(recalcAll(newRaw));
    },
    [rawValues]
  );

  const handleCellClick = (cellId) => {
    // if we were editing another cell, commit it first
    if (activeCell && activeCell !== cellId) {
      commitEdit(activeCell, editValue, rawValues);
    }
    setActiveCell(cellId);
    setEditValue(rawValues[cellId] || "");
  };

  const commitEdit = useCallback(
    (cellId, value, currentRaw) => {
      const newRaw = { ...currentRaw, [cellId]: value };
      undoStack.current.push({ ...currentRaw });
      redoStack.current = [];
      setRawValues(newRaw);
      setComputed(recalcAll(newRaw));
    },
    []
  );

  const handleKeyDown = (e, cellId) => {
    if (e.key === "Enter") {
      commitEdit(cellId, editValue, rawValues);
      setActiveCell(null);
    } else if (e.key === "Escape") {
      setActiveCell(null);
      setEditValue(rawValues[cellId] || "");
    } else if (e.key === "Tab") {
      e.preventDefault();
      commitEdit(cellId, editValue, rawValues);
      // move to next cell in row
      const colIdx = COLS.indexOf(cellId[0]);
      const rowNum = parseInt(cellId.slice(1));
      if (colIdx < COLS.length - 1) {
        setActiveCell(COLS[colIdx + 1] + rowNum);
        setEditValue(rawValues[COLS[colIdx + 1] + rowNum] || "");
      } else {
        setActiveCell(null);
      }
    }
  };

  const handleUndo = () => {
    if (undoStack.current.length === 0) return;
    const prev = undoStack.current.pop();
    redoStack.current.push({ ...rawValues });
    setRawValues(prev);
    setComputed(recalcAll(prev));
    setActiveCell(null);
  };

  const handleRedo = () => {
    if (redoStack.current.length === 0) return;
    const next = redoStack.current.pop();
    undoStack.current.push({ ...rawValues });
    setRawValues(next);
    setComputed(recalcAll(next));
    setActiveCell(null);
  };

  const handleBlur = (cellId) => {
    if (activeCell === cellId) {
      commitEdit(cellId, editValue, rawValues);
      setActiveCell(null);
    }
  };

  const getDisplayValue = (cellId) => {
    if (activeCell === cellId) return editValue;
    return computed[cellId] || "";
  };

  const getCellClass = (cellId) => {
    const val = computed[cellId];
    if (val === "#CIRCULAR") return "cell error circular";
    if (val === "#ERROR") return "cell error";
    if (activeCell === cellId) return "cell active";
    return "cell";
  };

  // figure out what to show in the formula bar
  const formulaBarValue =
    activeCell ? (editValue || "") : (activeCell ? rawValues[activeCell] || "" : "");

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <span className="logo">⬛ SheetEngine</span>
          <span className="subtitle">formula spreadsheet</span>
        </div>
        <div className="header-right">
          <button
            className="btn"
            onClick={handleUndo}
            disabled={undoStack.current.length === 0}
            title="Undo (Ctrl+Z)"
          >
            ↩ Undo
          </button>
          <button
            className="btn"
            onClick={handleRedo}
            disabled={redoStack.current.length === 0}
            title="Redo (Ctrl+Y)"
          >
            ↪ Redo
          </button>
        </div>
      </header>

      {/* formula bar */}
      <div className="formula-bar">
        <span className="cell-label">{activeCell || "—"}</span>
        <span className="fx-label">fx</span>
        <span className="formula-display">
          {activeCell ? (rawValues[activeCell] || "") : ""}
        </span>
      </div>

      <div className="grid-wrapper">
        <table className="grid">
          <thead>
            <tr>
              <th className="corner-cell"></th>
              {COLS.map((col) => (
                <th key={col} className="col-header">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row}>
                <td className="row-header">{row}</td>
                {COLS.map((col) => {
                  const cellId = col + row;
                  const isActive = activeCell === cellId;
                  const displayVal = computed[cellId] || "";
                  const isError =
                    displayVal === "#CIRCULAR" || displayVal === "#ERROR";

                  return (
                    <td
                      key={cellId}
                      className={`cell-td ${isActive ? "active-td" : ""}`}
                      onClick={() => handleCellClick(cellId)}
                    >
                      {isActive ? (
                        <input
                          className="cell-input"
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => handleKeyDown(e, cellId)}
                          onBlur={() => handleBlur(cellId)}
                        />
                      ) : (
                        <span
                          className={`cell-value ${isError ? "cell-err-text" : ""}`}
                        >
                          {displayVal}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer className="footer">
        <span>Type values or formulas starting with <code>=</code> &nbsp;|&nbsp; Press Enter to confirm, Escape to cancel, Tab to move</span>
      </footer>
    </div>
  );
}
