import MathText from './MathText'

const humanise = (value) => String(value || 'structured content').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())

function EquationCollection({ equations, title }) {
  return <div className="equation-system-block" aria-label={title}>
    <span className="equation-brace">{'{'}</span>
    <div>{equations.map((equation, index) => <MathText block key={index}>{String(equation)}</MathText>)}</div>
  </div>
}

function StructuredValue({ name, value, depth = 0 }) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'object') return <div className="structured-field"><strong>{humanise(name)}</strong><MathText>{String(value)}</MathText></div>
  if (Array.isArray(value)) {
    if (!value.length) return null
    if (value.every((item) => typeof item !== 'object')) {
      const maths = /equation|expression|formula|line/i.test(name)
      return <div className="structured-field"><strong>{humanise(name)}</strong>{maths ? <EquationCollection equations={value} title={name} /> : <div className="structured-values">{value.map((item, index) => <span key={index}><MathText>{String(item)}</MathText></span>)}</div>}</div>
    }
    return <div className="structured-group"><strong>{humanise(name)}</strong><div className="structured-items">{value.map((item, index) => <div className="structured-item" key={index}>{Object.entries(item || {}).map(([key, child]) => <StructuredValue name={key} value={child} depth={depth + 1} key={key} />)}</div>)}</div></div>
  }
  if (depth > 2) return null
  return <div className="structured-group"><strong>{humanise(name)}</strong>{Object.entries(value).map(([key, child]) => <StructuredValue name={key} value={child} depth={depth + 1} key={key} />)}</div>
}

export default function GenericStructuredBlock({ block }) {
  const equations = Array.isArray(block.equations) ? block.equations : Array.isArray(block.expressions) ? block.expressions : null
  if (equations) return <EquationCollection equations={equations} title={humanise(block.type)} />
  const visibleEntries = Object.entries(block).filter(([key]) => key !== 'type')
  return <section className="generic-structured-block">
    <div className="generic-block-title">{humanise(block.type)}</div>
    {visibleEntries.length ? visibleEntries.map(([key, value]) => <StructuredValue name={key} value={value} key={key} />) : <p>Response area</p>}
  </section>
}
