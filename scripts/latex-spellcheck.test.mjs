import assert from 'node:assert/strict'
import test from 'node:test'
import en from 'dictionary-en'
import { SpellcheckEngine } from '../src/services/SpellcheckEngine.js'
import { latexSpellcheckSegments } from '../src/services/LatexSpellcheckScanner.js'
import { locateSpellcheckErrors } from '../src/services/SpellcheckSegments.js'

const checker = new SpellcheckEngine(en.aff.toString(), en.dic.toString())
function errors(source) {
  const segments = latexSpellcheckSegments(source)
  const result = locateSpellcheckErrors(segments.flatMap(segment => checker.scan(segment)), segments)
  for (const error of result) assert.equal(source.slice(error.position, error.position + error.original.length), error.original)
  return result.map(error => error.original)
}
test('source checks prose/known text args, protects math, cite, paths, comments and unknown macros', () => {
  const source = String.raw`\documentclass{recieve}
\usepackage{recieve}
\title{A recieve title}
\begin{document}
😀 We recieve \textbf{teh \emph{seperate} result}.
$recieve + x$ $$recieve$$ \(recieve\) \[recieve\]
\begin{align*}recieve &= x\end{align*}
\cite[recieve]{recieve} \label{recieve} \ref{recieve}
\url{https://recieve.invalid} \href{https://recieve.invalid}{occured}
% recieve
\verb|recieve| \verb*+recieve+
\begin{verbatim}recieve\end{verbatim}
\begin{minted}{recieve}recieve\end{minted}
\unknown{recieve}{recieve}
\caption[recieve]{seperate}
\end{document}
recieve`
  assert.deepEqual(errors(source), ['recieve', 'recieve', 'teh', 'seperate', 'occured', 'recieve', 'seperate'])
})
test('escaped dollar and percent preserve prose and mixed CRLF offsets', () => {
  assert.deepEqual(errors(String.raw`We pay \$5 and recieve 10\% of teh sum.` + '\r\n' + 'seperate'), ['recieve', 'teh', 'seperate'])
})
test('unknown environments, malformed math/groups and commented delimiters stay conservative', () => {
  assert.deepEqual(errors(String.raw`We recieve $teh`), ['recieve'])
  assert.deepEqual(errors(String.raw`We recieve \textbf{teh`), ['recieve'])
  assert.deepEqual(errors(String.raw`\begin{unknown}recieve\end{unknown} teh`), ['teh'])
  assert.deepEqual(errors('\\textbf{recieve % }\n teh}'), ['recieve', 'teh'])
  assert.deepEqual(errors(String.raw`\begin{tabular}{recieve}teh & seperate\\\end{tabular}`), ['teh', 'seperate'])
})
test('macro definitions, unbraced inputs and nested opaque environments never become prose', () => {
  assert.deepEqual(errors(String.raw`\newcommand{\foo}[1][recieve]{recieve #1} teh`), ['teh'])
  assert.deepEqual(errors(String.raw`\renewcommand\foo[1]{recieve #1} teh`), ['teh'])
  assert.deepEqual(errors(String.raw`\def\foo#1{recieve #1} teh`), ['teh'])
  assert.deepEqual(errors(String.raw`\newenvironment{foo}[1]{recieve}{recieve} teh`), ['teh'])
  assert.deepEqual(errors(String.raw`\input recieve.tex teh`), ['teh'])
  assert.deepEqual(errors(String.raw`\begin{align}recieve \begin{align}recieve\end{align}recieve\end{align} teh`), ['teh'])
})
