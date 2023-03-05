import { EditorState, Transaction, Plugin, PluginKey, TextSelection, Command } from "prosemirror-state"
import { Decoration, DecorationSet } from "prosemirror-view"
import { Node } from "prosemirror-model"

// we want to treat the "search" pattern as a lint, but then mark it differently
// in general we might want different kinds of lint, like chill blue and angry red.
const chillColor = 'blue'

// this should probably not be globals; we might want to have two editors with different search parameters

type SearchData = {
  ds?: DecorationSet
  searchPattern: string
  replace: string
  matchCase: false
  matchIndex: number
  matchCount: number
  matchWholeWord: boolean
  findInSelection: boolean
}

export const pluginKey = new PluginKey<SearchData>('search-replace2');
function getSearch(editorState: EditorState) {
  return pluginKey.getState(editorState);
}
class Match {
  constructor(public begin: number, public end: number) { }
}

function search(s: string, p: SearchData): Match[] {
  if (!p.searchPattern)
    return []
  const r: Match[] = []
  const sp = p.matchCase ? p.searchPattern : p.searchPattern.toLowerCase()
  const xx = p.matchCase ? s : s.toLowerCase()
  let idx = xx.indexOf(sp)

  while (idx !== -1) {
    r.push(new Match(idx, idx + p.searchPattern.length));
    idx = s.indexOf(p.searchPattern, idx + 1);
  }
  return r
}

// this should probably be in prose-mirror, it's a common structure passed to functions
interface Dispatch {
  state: EditorState,
  dispatch: (e: Transaction) => void
}

// Each lint identified. 
interface LintResult {
  color?: string,
  msg: string, from: number, to: number, fix?: (props: Dispatch) => void
}
// we will store the problem information directly on the icon decoration, so this extends the HTMLElement for typescript
interface LintIconDiv extends HTMLElement {
  ["data-problem"]?: LintResult
}
// create div for our lint icon.
function lintIcon(prob: LintResult) {
  let icon = document.createElement("div") as LintIconDiv
  icon.className = "lint-icon"
  icon.title = prob.msg;
  icon["data-problem"] = prob
  if (prob.color)
    icon.style.backgroundColor = prob.color
  return icon
}

// Words you probably shouldn't use
const badWords = /\b(obviously|clearly|evidently|simply)\b/ig
// Matches punctuation with a space before it
const badPunc = / ([,\.!?:]) ?/g



function lint(doc: Node, sd: SearchData) {
  let result: LintResult[] = []
  let lastHeadLevel: number | null = null

  // For each node in the document
  doc.descendants((node: Node, pos: number, parent: Node | null) => {
    if (node.isText) {
      // add search 
      const sr = search(node.text ?? "", sd)
      for (let o of sr) {
        result.push({
          color: 'green',
          msg: sd.replace,
          from: pos + o.begin,
          to: pos + o.end
        })
      }


      // Scan text nodes for suspicious patterns
      //let text = node.text
      let m: RegExpExecArray | null
      while (m = badWords.exec(node.text!)) {
        const from = pos + m.index
        const to = pos + m.index + m[0].length
        result.push({ msg: `Try not to say '${m[0]}'`, from, to })
      }

      while (m = badPunc.exec(node.text!)) {
        const from = pos + m.index
        const to = pos + m.index + m[0].length
        const fix = ({ state, dispatch }: Dispatch) => {
          dispatch(state.tr.replaceWith(from, to,
            state.schema.text(m![1] + " ")))
        }
        result.push({
          msg: "Suspicious spacing around punctuation",
          color: chillColor,
          from, to, fix
        })
      }
    } else if (node.type.name == "heading") {
      // Check whether heading levels fit under the current level
      let level = node.attrs.level
      if (lastHeadLevel != null && level > lastHeadLevel + 1) {
        const from = pos + 1
        const to = pos + 1 + node.content.size

        const fix = ({ state, dispatch }: Dispatch) => {
          dispatch(state.tr.setNodeMarkup(from - 1, null, { level: lastHeadLevel! + 1 }))
        }
        result.push({ msg: `Heading too small (${level} under ${lastHeadLevel})`, from, to, fix })
      }

      lastHeadLevel = level
    } else if (node.type.name == "image" && !node.attrs.alt) {
      // Ensure images have alt text
      const from = pos
      const to = pos + 1
      let alt = prompt("Alt text", "")
      const fix = ({ state, dispatch }: Dispatch) => {
        if (alt) {
          let attrs = Object.assign({}, state.doc.nodeAt(from)?.attrs, { alt })
          dispatch(state.tr.setNodeMarkup(from, null, attrs))
        }
      }
      result.push({ msg: "Image without alt text", from, to, fix })
    }
  })

  return result
}
// returns the new state of the plugin.
function lintDeco(doc: Node, sd: SearchData): SearchData {
  let decos: Decoration[] = []
  lint(doc, sd).forEach(prob => {
    const cl = `problem-${prob.color ?? "red"}`
    decos.push(Decoration.inline(prob.from, prob.to, { class: cl }),
      Decoration.widget(prob.from, lintIcon(prob)))
  })
  const r = {
    ...sd,
    ds: DecorationSet.create(doc, decos)
  }
  console.log("new state", r)
  return r
}

export function lintPlugin() {
  const st: SearchData = {
    searchPattern: "",
    replace: "",
    matchCase: false,
    matchIndex: 0,
    matchCount: 0,
    matchWholeWord: false,
    findInSelection: false
  }
  let r = new Plugin({
    key: pluginKey,
    state: {
      // lint the very first time.
      init(_, { doc }) {
        return lintDeco(doc, st)
      },
      // this runs every time the document changes, not efficient.
      apply(tr, old) {
        const getMeta = tr.getMeta(pluginKey)
        if (getMeta) {
          return lintDeco(tr.doc, getMeta)
        }
        console.log("changed",)
        return tr.docChanged ? lintDeco(tr.doc, old) : old
      }
    },

    props: {
      decorations(state: EditorState) {
        return this.getState(state)?.ds
      },
      // note that these event handlers are for the entire editor, we need to check first if the click falls on one of our icons.
      handleClick(view, _, event: MouseEvent) {
        const el = event.target as HTMLElement
        const result = (event.target as LintIconDiv)["data-problem"]
        if (result && /lint-icon/.test(el.className)) {
          let { from, to } = result
          view.dispatch(
            view.state.tr
              .setSelection(TextSelection.create(view.state.doc, from, to))
              .scrollIntoView())
          return true
        }
      },
      handleDoubleClick(view, _, event) {
        const el = event.target as HTMLElement
        const result = (event.target as LintIconDiv)["data-problem"]
        if (result && /lint-icon/.test(el.className)) {
          let prob = result
          if (prob.fix) {
            prob.fix(view)
            view.focus()
            return true
          }
        }
      }
    }
  })
  return r
}

// build a search command
export function searchCommand(s: string): Command {
  return (state: EditorState, dispatch) => {
    let sd = pluginKey.getState(state)
    if (!sd) {
      console.log("no state")
      return false
    }
    if (dispatch) {
      let newSearch = {
        ...sd,
        searchPattern: s
      }
      console.log(newSearch)
      dispatch(state.tr.setMeta(pluginKey, newSearch))
    }
    return true
  }
}
