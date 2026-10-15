import katex from 'katex'

export default function MathText({ children = '', block = false }) {
  const text = String(children)
  const segments = text.split(/((?<!\\)\$\$[\s\S]+?(?<!\\)\$\$|(?<!\\)\$[^$\n]+?(?<!\\)\$)/g).filter(Boolean)
  return (
    <span className={block ? 'math-text block' : 'math-text'}>
      {segments.map((segment, index) => {
        const display = segment.startsWith('$$') && segment.endsWith('$$')
        const inline = !display && segment.startsWith('$') && segment.endsWith('$')
        if (!display && !inline) return <span key={index}>{segment.replace(/\\\$/g, '$')}</span>
        try {
          const latex = segment.slice(display ? 2 : 1, display ? -2 : -1)
          return <span key={index} className={display ? 'display-math' : 'inline-math'} dangerouslySetInnerHTML={{ __html: katex.renderToString(latex, { throwOnError: false, displayMode: display, strict: false }) }} />
        } catch {
          return <span key={index} className="math-error" title="Could not render this expression">{segment}</span>
        }
      })}
    </span>
  )
}
