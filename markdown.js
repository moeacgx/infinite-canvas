var R=new Set(["a","abbr","b","blockquote","br","code","del","details","div","em","h1","h2","h3","h4","h5","h6","hr","i","img","kbd","li","ol","p","pre","s","span","strong","sub","summary","sup","table","tbody","td","th","thead","tr","ul"]),b=new Set(["base","button","embed","form","iframe","input","link","meta","noscript","object","script","select","style","template","textarea"]),x=new Set(["class","dir","lang","title"]),v={a:new Set(["href"]),code:new Set(["class"]),img:new Set(["alt","height","loading","src","title","width"]),ol:new Set(["start"]),td:new Set(["colspan","rowspan"]),th:new Set(["colspan","rowspan","scope"])};var C=new Set(["href","src","xlink:href"]);function S(e){return e.trim().replace(/[\u0000-\u0020\u007f-\u009f]/g,"").toLowerCase()}function P(e,n){let t=S(e);return!t||t.startsWith("javascript:")||t.startsWith("vbscript:")||t.startsWith("file:")?!1:t.startsWith("data:")?n==="src"&&/^data:image\/(?:gif|jpe?g|png|webp);base64,/i.test(t):/^(?:https?:|mailto:|tel:|\/|\.?\.\/|#|\?)/i.test(t)||!/^[a-z][a-z0-9+.-]*:/i.test(t)}function E(e){let n=e.localName.toLowerCase();for(let t of Array.from(e.attributes)){let o=t.name.toLowerCase(),c=v[n];(!(x.has(o)||c?.has(o)||o==="aria-label")||o.startsWith("on")||o==="style"||C.has(o)&&!P(t.value,o))&&e.removeAttribute(t.name)}n==="a"&&e.hasAttribute("href")&&e.setAttribute("rel","nofollow noopener noreferrer"),n==="img"&&e.setAttribute("loading","lazy")}function f(e){for(let n of Array.from(e.childNodes)){if(n.nodeType!==1)continue;let t=n,o=t.localName.toLowerCase();if(!R.has(o)){b.has(o)?t.remove():(f(t),t.replaceWith(...Array.from(t.childNodes)));continue}E(t),f(t)}}function g(e){if(!e||typeof DOMParser>"u")return"";let n=new DOMParser().parseFromString(e,"text/html");return f(n.body),n.body.innerHTML}function h(){let e=globalThis.InfiniteCanvasRuntime;if(!e)throw new Error("[plugin-sdk] Infinite Canvas \u8FD0\u884C\u65F6\u672A\u5C31\u7EEA:\u8BF7\u5728\u753B\u5E03\u5BBF\u4E3B\u4E2D\u52A0\u8F7D\u672C\u63D2\u4EF6");return e}function s(){return h().React}var m=((...e)=>s().useState(...e)),l=((...e)=>s().useEffect(...e));var d=((...e)=>s().useRef(...e));var y=`.cnv-md {
    height: 100%;
    width: 100%;
    overflow: auto;
    padding: 16px;
    font-size: 14px;
    line-height: 1.6;
}
.cnv-md h1,
.cnv-md h2,
.cnv-md h3 {
    margin: 0.6em 0 0.3em;
    font-weight: 600;
    line-height: 1.3;
}
.cnv-md h1 {
    font-size: 1.5em;
}
.cnv-md h2 {
    font-size: 1.3em;
}
.cnv-md p {
    margin: 0.5em 0;
}
.cnv-md a {
    color: #6366f1;
    text-decoration: underline;
}
.cnv-md code {
    padding: 0.1em 0.35em;
    border-radius: 4px;
    background: rgba(120, 120, 120, 0.16);
    font-family: monospace;
    font-size: 0.9em;
}
.cnv-md pre {
    padding: 12px;
    border-radius: 8px;
    background: rgba(120, 120, 120, 0.14);
    overflow: auto;
}
.cnv-md pre code {
    padding: 0;
    background: transparent;
}
.cnv-md ul,
.cnv-md ol {
    padding-left: 1.4em;
    margin: 0.5em 0;
}
.cnv-md blockquote {
    margin: 0.5em 0;
    padding-left: 0.8em;
    border-left: 3px solid rgba(120, 120, 120, 0.4);
    opacity: 0.85;
}
.cnv-md img {
    max-width: 100%;
}
`;var A=Symbol.for("infinite-canvas.jsx.fragment");function L(e,n,t){let o=s(),c=e===A?o.Fragment:e,a=t===void 0?n:{...n??{},key:t};return o.createElement(c,a)}function u(e,n,t){return L(e,n,t)}var i,p;function z(){return i?Promise.resolve(i):(p||(p=import("https://esm.sh/marked@14").then(e=>i=e.marked)),p)}var I="*\u9009\u4E2D\u8282\u70B9,\u70B9\u4E0A\u65B9\u5DE5\u5177\u6761\u7684 \u270E \u7F16\u8F91 Markdown*",w=new Map;function H(e){if(!i)return"";let n=e||I,t=w.get(n);return t===void 0&&(t=g(i.parse(n)),w.set(n,t)),t}function N({ctx:e}){let[,n]=m(0),t=d(null),o=d(null);l(()=>{if(i)return;let r=!0;return z().then(()=>r&&n(k=>k+1)),()=>{r=!1}},[]);let c=e.node.metadata?.content||"",a=H(c);return l(()=>{let r=t.current;!r||o.current===a||(r.innerHTML=a,o.current=a)},[a]),u("div",{ref:t,className:"cnv-md","data-canvas-no-zoom":!0,onWheel:r=>r.stopPropagation(),style:{height:"100%",width:"100%",color:e.theme.node.text}})}function _({ctx:e}){let n=e.node.metadata?.content||"";return u("textarea",{autoFocus:!0,value:n,placeholder:"# \u8F93\u5165 Markdown",onChange:t=>e.updateMetadata({content:t.target.value}),onMouseDown:t=>t.stopPropagation(),onPointerDown:t=>t.stopPropagation(),onWheel:t=>t.stopPropagation(),style:{height:"100%",width:"100%",resize:"none",background:e.theme.node.fill,borderRadius:16,boxSizing:"border-box",padding:16,fontFamily:"monospace",fontSize:14,outline:"none",border:"none",color:e.theme.node.text}})}function F({ctx:e}){return e.node.metadata?.editing?u(_,{ctx:e}):u(N,{ctx:e})}var oe={id:"markdown",name:"Markdown \u8282\u70B9",version:"1.1.1",description:"\u5728\u753B\u5E03\u4E2D\u7F16\u8F91\u4E0E\u6E32\u67D3 Markdown",css:y,nodes:[{type:"markdown:doc",title:"Markdown",icon:"\u{1F4DD}",description:"\u7F16\u8F91\u4E0E\u6E32\u67D3 Markdown",defaultSize:{width:360,height:300},defaultMetadata:{content:""},minimapColor:"#6366f1",hidePanel:!0,interactionToggle:!0,forceInteractive:e=>!!e.metadata?.editing,resource:e=>({kind:"text",text:e.metadata?.content}),Content:F,toolbar:e=>{let n=!!e.node.metadata?.editing;return[{id:"md-toggle-edit",title:n?"\u9884\u89C8\u6E32\u67D3\u7ED3\u679C":"\u7F16\u8F91 Markdown \u6E90\u7801",label:n?"\u9884\u89C8":"\u7F16\u8F91",icon:n?"\u{1F441}":"\u270E",active:n,onClick:()=>e.updateMetadata({editing:!n})}]}}]};export{oe as default};
