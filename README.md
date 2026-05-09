# Spreadsheet Engine

A React-based spreadsheet with formula evaluation, dependency tracking, circular reference detection, and undo/redo.

## Features

- 10×10 grid (columns A–J, rows 1–10)
- Formula evaluation: `=A1+B2`, `=A1*2`, `=(C1+D1)/3`, etc.
- Automatic dependency propagation — change A1, and B1=A1+3 updates instantly
- Circular reference detection (`#CIRCULAR`)
- Invalid formula handling (`#ERROR`)
- Undo / Redo support

## How to Run

```bash
npm install
npm start
```

Then open [http://localhost:3000](http://localhost:3000).

## Usage

- Click any cell to edit it
- Type a plain value (number or text) or a formula starting with `=`
- Press **Enter** to confirm, **Escape** to cancel, **Tab** to move to next cell
- Use **Undo** / **Redo** buttons in the top-right corner

## Formula Examples

```
=A1+B2        add two cells
=A1*2         multiply by constant
=(C1+D1)/3    parentheses work
=A1+B2-C3     multiple cell refs
```

## Error Handling

| Value       | Meaning                                |
|-------------|----------------------------------------|
| `#ERROR`    | Invalid formula or malformed expression |
| `#CIRCULAR` | Cell is part of a circular dependency  |

## Architecture Notes

- **Dependency graph**: built fresh on every cell edit — each formula cell maps to its referenced cells
- **Topological sort**: Kahn's algorithm determines safe evaluation order
- **Cycle detection**: if topo sort can't order all cells, a DFS finds exactly which cells are cyclic
- **Formula eval**: cell refs are replaced with their computed values, then evaluated via `Function()`
- **Undo/redo**: snapshots of raw cell values stored in two stacks (useRef, no re-render overhead)
