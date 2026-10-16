const textCommands = new Map([
  ...['title', 'section', 'subsection', 'subsubsection', 'chapter', 'paragraph', 'subparagraph', 'caption', 'footnote', 'text', 'textrm', 'textsf', 'texttt', 'textbf', 'textit', 'textnormal', 'emph', 'underline', 'mbox', 'makebox'].map(name => [name, 1]),
  ['href', 2], ['textcolor', 2], ['colorbox', 2],
])
const proseEnvironments = new Set(['document', 'abstract', 'itemize', 'enumerate', 'description', 'quote', 'quotation', 'center', 'flushleft', 'flushright', 'figure', 'figure*', 'table', 'table*', 'tabular', 'tabular*', 'tabularx', 'longtable', 'minipage', 'multicols'])
const noArgumentCommands = new Set(['item', 'par', 'newline', 'linebreak', 'smallskip', 'medskip', 'bigskip', 'noindent', 'maketitle', 'tableofcontents', 'centering', 'raggedright', 'raggedleft', 'newpage', 'clearpage', 'hfill', 'vfill', 'TeX', 'LaTeX', 'ldots', 'dots', 'toprule', 'midrule', 'bottomrule'])

// Conservative lexer: unknown macros/environments are opaque, offsets stay in source.
export function latexSpellcheckSegments(source) {
  const output = []
  let prose = !/\\begin\s*\{document\}/u.test(source)
  function add(from, to) {
    if (to <= from || !source.slice(from, to).trim()) return
    output.push({ id: `source:${from}`, text: source.slice(from, to), target: { kind: 'source', from } })
  }
  function skipSpace(at, limit) { while (at < limit && /\s/u.test(source[at])) at++; return at }
  function group(at, limit, open = '{', close = '}') {
    if (source[at] !== open) return null
    let depth = 1
    for (let index = at + 1; index < limit; index++) {
      if (source[index] === '\\') { index++; continue }
      if (source[index] === '%') { const newline = source.indexOf('\n', index); if (newline < 0) return null; index = newline; continue }
      if (source[index] === open) depth++
      if (source[index] === close && --depth === 0) return { from: at + 1, to: index, end: index + 1 }
    }
    return null
  }
  function opaqueEnvironment(at, limit, name) {
    if (['verbatim', 'verbatim*', 'lstlisting', 'minted'].includes(name)) {
      const closing = `\\end{${name}}`, end = source.indexOf(closing, at)
      return end < 0 ? limit : Math.min(limit, end + closing.length)
    }
    let nested = 1
    for (let cursor = at; cursor < limit;) {
      if (source[cursor] === '%') { const newline = source.indexOf('\n', cursor); cursor = newline < 0 ? limit : newline + 1; continue }
      if (source[cursor] !== '\\') { cursor++; continue }
      const match = /^\\(begin|end)\s*\{([^}]+)\}/u.exec(source.slice(cursor, limit))
      if (match) {
        if (match[2] === name) nested += match[1] === 'begin' ? 1 : -1
        cursor += match[0].length
        if (!nested) return cursor
      } else cursor += 2
    }
    return limit
  }
  function scan(start, limit, enabled, depth = 0) {
    if (depth > 100) return
    let index = start, plainStart = start
    const flush = end => { if (enabled) add(plainStart, end) }
    while (index < limit) {
      const char = source[index]
      if (char === '%') {
        flush(index)
        const newline = source.indexOf('\n', index)
        index = newline < 0 ? limit : Math.min(limit, newline + 1); plainStart = index
      } else if (char === '$') {
        flush(index)
        const delimiter = source[index + 1] === '$' ? '$$' : '$'
        let end = index + delimiter.length
        while (end < limit) {
          if (source[end] === '\\') { end += 2; continue }
          if (source.startsWith(delimiter, end)) break
          end++
        }
        index = end >= limit ? limit : end + delimiter.length; plainStart = index
      } else if (char === '\\') {
        flush(index)
        const commandStart = index
        index++
        if ('(['.includes(source[index] || '\0')) {
          const closing = source[index] === '(' ? '\\)' : '\\]'
          const end = source.indexOf(closing, index + 1)
          index = end < 0 ? limit : end + 2; plainStart = index; continue
        }
        const match = /^[A-Za-z@]+\*?/u.exec(source.slice(index, limit))
        if (!match) { index = Math.min(limit, index + 1); plainStart = index; continue }
        const name = match[0].replace(/\*$/u, '')
        index += match[0].length
        if (name === 'verb') {
          const delimiter = source[index]
          const end = delimiter ? source.indexOf(delimiter, index + 1) : -1
          index = end < 0 ? limit : end + 1; plainStart = index; continue
        }
        let cursor = skipSpace(index, limit)
        if (['def', 'gdef', 'edef', 'xdef'].includes(name)) {
          while (cursor < limit && source[cursor] !== '{' && source[cursor] !== '\n') cursor++
          const value = group(cursor, limit)
          index = value ? value.end : limit; plainStart = index; continue
        }
        if (['newcommand', 'renewcommand', 'providecommand', 'DeclareRobustCommand', 'newenvironment', 'renewenvironment'].includes(name)) {
          const macro = group(cursor, limit)
          if (macro) cursor = skipSpace(macro.end, limit)
          else if (source[cursor] === '\\') { const token = /^\\[A-Za-z@]+/u.exec(source.slice(cursor, limit)); cursor = token ? skipSpace(cursor + token[0].length, limit) : limit }
          else cursor = limit
          while (source[cursor] === '[') { const option = group(cursor, limit, '[', ']'); cursor = option ? skipSpace(option.end, limit) : limit }
          const bodies = name.endsWith('environment') ? 2 : 1
          for (let argument = 0; argument < bodies; argument++) { const body = group(cursor, limit); cursor = body ? skipSpace(body.end, limit) : limit }
          index = cursor; plainStart = index; continue
        }
        if (['input', 'include'].includes(name) && source[cursor] !== '{') {
          while (cursor < limit && !/\s/u.test(source[cursor])) cursor++
          index = cursor; plainStart = index; continue
        }
        if (name === 'begin' || name === 'end') {
          const environment = group(cursor, limit)
          if (!environment) { index = limit; plainStart = index; continue }
          const env = source.slice(environment.from, environment.to).trim()
          index = environment.end
          if (name === 'begin') {
            if (!proseEnvironments.has(env)) {
              index = opaqueEnvironment(index, limit, env)
            } else {
              if (env === 'document') { prose = true; enabled = true }
              if (['tabular', 'tabular*', 'tabularx', 'longtable', 'minipage', 'multicols'].includes(env)) {
                cursor = skipSpace(index, limit)
                while (source[cursor] === '[') {
                  const option = group(cursor, limit, '[', ']'); if (!option) { cursor = limit; break }
                  cursor = skipSpace(option.end, limit)
                }
                const count = ['tabular*', 'tabularx'].includes(env) ? 2 : 1
                for (let arg = 0; arg < count; arg++) { const value = group(cursor, limit); if (!value) { cursor = limit; break }; cursor = skipSpace(value.end, limit) }
                index = cursor
              }
            }
          } else if (env === 'document') { prose = false; enabled = false }
          plainStart = index; continue
        }
        while (source[cursor] === '[') {
          const option = group(cursor, limit, '[', ']')
          if (!option) { cursor = limit; break }
          // Optional short headings are prose; other optional args stay opaque.
          if (['title', 'section', 'subsection', 'subsubsection', 'chapter', 'caption'].includes(name)) scan(option.from, option.to, true, depth + 1)
          cursor = skipSpace(option.end, limit)
        }
        const argumentsCount = textCommands.get(name)
        if (argumentsCount) {
          for (let arg = 1; arg <= argumentsCount; arg++) {
            const value = group(cursor, limit)
            if (!value) { cursor = limit; break }
            if (arg === argumentsCount) scan(value.from, value.to, true, depth + 1)
            cursor = skipSpace(value.end, limit)
          }
          index = cursor
        } else if (noArgumentCommands.has(name)) {
          index = cursor
        } else {
          // Skip adjacent unknown arguments, but preserve ordinary prose after a macro.
          let hadGroup = false
          while (source[cursor] === '{') {
            hadGroup = true
            const value = group(cursor, limit)
            if (!value) { cursor = limit; break }
            cursor = skipSpace(value.end, limit)
          }
          index = hadGroup || cursor >= limit ? cursor : index
        }
        if (index <= commandStart) index = commandStart + 1
        plainStart = index
      } else if (char === '{') {
        flush(index)
        const value = group(index, limit)
        if (!value) { index = limit; plainStart = index; continue }
        scan(value.from, value.to, enabled, depth + 1)
        index = value.end; plainStart = index
      } else if (char === '}') {
        flush(index); index++; plainStart = index
      } else index++
    }
    flush(limit)
  }
  scan(0, source.length, prose)
  return output
}
