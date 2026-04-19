import { useState } from 'preact/hooks'
import { exportDb, downloadExport } from './db.js'
import { GIT_SHA, GIT_DATE, GIT_DATE_SHORT, BUILD_TIME } from './version.js'
import { usePwaInstall } from './usePwaInstall.js'

const isDev = location.pathname.includes('/dev/')

// Hamburger menu: upload paths (files / folder / URL), export, install
// prompt (when available), destructive reset, Prod/Dev env toggle, and
// a build-identity line. Owns its own open/closed state plus the PWA
// install hook.
//
// Props (parent-owned actions):
//   onUpload(e)         — files input change event; parent runs importer
//   onUploadFolder()    — folder-picker flow
//   onFetchUrl(url)     — URL import
//   onReset()           — "Reset all data" confirmation flow
export function LibraryMenu({ onUpload, onUploadFolder, onFetchUrl, onReset }) {
  let [open, setOpen] = useState(false)
  let { canInstall, install } = usePwaInstall()

  let close = () => setOpen(false)
  let exportData = async () => { close(); downloadExport(await exportDb()) }
  let promptUrl = () => {
    close()
    let url = prompt('Enter URL to SGF or archive:', 'https://files.catbox.moe/r92xsw.zip')
    if (url) onFetchUrl(url)
  }

  return (
    <div class="menu-wrap">
      <button class="menu-toggle" title="Menu" onClick={() => setOpen(v => !v)}>☰</button>
      {open && <>
        <div class="menu-backdrop" onClick={close} />
        <div class="menu-dropdown">
          <label class="menu-item">
            Upload files
            <input type="file" accept=".sgf,.zip,.tar.gz,.tgz,.tar" multiple
                   onChange={e => { close(); onUpload(e) }} hidden />
          </label>
          <button class="menu-item" onClick={() => { close(); onUploadFolder() }}>Upload folder</button>
          <button class="menu-item" onClick={promptUrl}>Upload from URL</button>
          <button class="menu-item" onClick={exportData}>Export data</button>
          {canInstall && <button class="menu-item" onClick={() => { close(); install() }}>Install app</button>}
          <button class="menu-item menu-danger" onClick={() => { close(); onReset() }}>Reset all data</button>
          <div class="menu-sep" />
          <div class="env-toggle">
            <a class={`env-btn${isDev ? '' : ' env-active'}`} href={isDev ? '../' : undefined} onClick={() => localStorage.setItem('preferredEnv', 'prod')}>Prod</a>
            <a class={`env-btn${isDev ? ' env-active' : ''}`} href={isDev ? undefined : 'dev/'} onClick={() => localStorage.setItem('preferredEnv', 'dev')}>Dev</a>
          </div>
          <div class="menu-version" title={`commit ${GIT_DATE}\nbuilt  ${BUILD_TIME || ''}`}>
            <div>{GIT_SHA}{GIT_DATE_SHORT && ` · ${GIT_DATE_SHORT}`}</div>
          </div>
        </div>
      </>}
    </div>
  )
}
