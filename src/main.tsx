import { createSignal, createEffect, JSXElement, onMount, Component } from 'solid-js'
import { render } from 'solid-js/web'
import { Icon } from 'solid-heroicons'
import { xMark, check } from 'solid-heroicons/solid'
import './index.css'

import { Editor } from './editor'
import { html2md, md2html } from './md'
import { search, setReplace, setSearch, setTitle } from './state'
import { searchCommand } from './lint'
import { EditorView } from 'prosemirror-view'

const ed = new Editor
let original = ""
let webview = (window as any).chrome?.webview
// when we paste we should try to understand if its markdown or html we are pasting
// convert markdown to html

function reply(x: string) {
  if (webview) {
    webview.postMessage(x)
  } else {
    console.log("no webview", x)
  }
}
async function save() {
  const x = ed.text
  console.log("save", x)
  reply(await html2md(ed.text))
}
const cancel = () => {
  reply(original)
}
onmessage = (e) => {
  console.log(e)
  original = e.data
  md2html(e.data).then(e => {
    ed.text = e
  })
}

function Button(props: {
  onClick: () => void,
  class: string,
  children: JSXElement
}) {
  return <button onclick={props.onClick} class={`${props.class} inline-flex items-center rounded-md border border-transparent px-3 py-2 text-sm font-medium leading-4 text-white shadow-sm  focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2`}>{props.children}</button>
}

// get the text from the app using the iframe, then post it back.
function EditorApp() {
  // we can try to recreate the editor as raw typescript to make it easier to wrap in various frameworks. 

  let el: HTMLDivElement
  createEffect(() => {
    console.log(search())
    if (ed?.view)
      searchCommand(search())(ed.view!.state, ed.view!.dispatch, ed.view)
  })
  onMount(() => {
    ed.mount(el)
    ed.text = ""
  })
  return <div class='w-screen h-screen'>
    <div class='h-12 bg-neutral-800 p-1 flex '>
      <Button onClick={save} class='mx-1 bg-indigo-600 hover:bg-indigo-700 hidden'>Save<Icon class='ml-1 h-4 w-4' path={check} /></Button>
      <input class='rounded-md pl-1' placeholder='search' onInput={(x: any) => setSearch(x.target.value)} />
      <Button onClick={cancel} class='mx-1 bg-red-600 hover:bg-red-700 hidden'>Cancel<Icon class='ml-1 h-4 w-4' path={xMark} /></Button>
    </div>
    <div class='mt-2 h-full w-full max-w-none prose dark:prose-invert' ref={el!} />
  </div>
}

render(() => <EditorApp />, document.getElementById('app')!)

if (webview) {
  webview.addEventListener('message', (x: MessageEvent) => {
    let [a, b] = x.data.split("!~~!")
    setTitle(a)
    ed.text = b
    console.log(x, a, b)
  })
  reply("!~~!")
}