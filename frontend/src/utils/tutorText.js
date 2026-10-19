// Model text marks maths with $...$; models sometimes use $$...$$ or \(...\) instead.
export function normaliseMath(text) {
  return text
    .replace(/\$\$([^$]+)\$\$/g, (_, math) => `$${math}$`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, math) => `$${math}$`)
}
