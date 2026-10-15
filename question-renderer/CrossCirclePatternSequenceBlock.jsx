export default function CrossCirclePatternSequenceBlock({ block }) {
  const patterns = Array.isArray(block.patterns) ? block.patterns : []
  if (!patterns.length || patterns.some((pattern) => !Number.isInteger(Number(pattern.pattern_number)) || !Array.isArray(pattern.grid_rows) || !pattern.grid_rows.length)) {
    return <div className="unsupported-block">Cross-and-circle sequence needs numbered patterns with grid rows.</div>
  }

  return <figure className="cross-circle-sequence">
    <div className="cross-circle-patterns">
      {patterns.map((pattern) => <div className="cross-circle-pattern" key={pattern.pattern_number}>
        <div className="cross-circle-grid" role="img" aria-label={pattern.blank ? `Pattern ${pattern.pattern_number}: space to draw the next pattern` : `Pattern ${pattern.pattern_number}: ${pattern.crosses} crosses and ${pattern.circles} circles`}>
          {pattern.grid_rows.map((row, rowIndex) => <div className="cross-circle-row" key={rowIndex}>
            {[...row].map((symbol, columnIndex) => <span className={`cross-circle-cell ${symbol === '.' ? 'cross-circle-empty' : ''}`} key={columnIndex} aria-hidden="true">
              {symbol === 'x' ? '×' : symbol === 'o' ? <span className="circle-symbol" /> : null}
            </span>)}
          </div>)}
        </div>
        <strong>Pattern {pattern.pattern_number}</strong>
      </div>)}
    </div>
    {block.layout_inferred_from_counts && <figcaption>Symbol placement is reconstructed from the counts; compare it with the source paper.</figcaption>}
  </figure>
}
