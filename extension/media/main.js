/* global acquireVsCodeApi */
// DeepSeek Harness sidebar panel — webview UI.
// The extension host owns every piece of state; this file only renders and
// posts intents. No framework, no build step.

(function () {
  'use strict'

  const vscode = acquireVsCodeApi()
  const post = (message) => vscode.postMessage(message)

  const ICONS = {
    history:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="8" cy="8" r="5.6"/><path d="M8 4.9V8l2.2 1.4" stroke-linecap="round"/></svg>',
    plus:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M8 3.4v9.2M3.4 8h9.2"/></svg>',
    send:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 12.5V3.8M4.3 7.4 8 3.6l3.7 3.8"/></svg>',
    stop:
      '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="4.4" y="4.4" width="7.2" height="7.2" rx="1.3"/></svg>',
    close:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6"/></svg>',
    spark:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M4.2 6.1A2.9 2.9 0 0 1 7.1 3.2h9.8a2.9 2.9 0 0 1 2.9 2.9v7.6a2.9 2.9 0 0 1-2.9 2.9h-6.5l-4.2 3.3a.9.9 0 0 1-1.4-.7V6.1Z"/><circle cx="9" cy="9.7" r="1" fill="currentColor"/><circle cx="12.3" cy="9.7" r="1" fill="currentColor"/><circle cx="15.6" cy="9.7" r="1" fill="currentColor"/></svg>',
  }

  const app = document.getElementById('app')
  app.innerHTML = `
    <div class="panel">
      <div class="topbar">
        <span class="conn-dot" id="conn" title="连接状态"></span>
        <div class="titles">
          <div class="title" id="title">DeepSeek Harness</div>
          <div class="subtitle" id="subtitle">正在连接…</div>
        </div>
        <div class="actions">
          <button class="icon" id="btn-history" title="历史会话" aria-label="历史会话">${ICONS.history}</button>
          <button class="icon" id="btn-new" title="新建会话" aria-label="新建会话">${ICONS.plus}</button>
          <button class="icon" id="btn-more" title="更多" aria-label="更多">⋯</button>
        </div>
      </div>

      <div class="menu" id="more-menu" hidden>
        <button id="menu-rename">重命名当前会话</button>
        <button id="menu-fork">从当前会话创建分支</button>
      </div>

      <div class="banner" id="banner" hidden>
        <span class="banner-text" id="banner-text"></span>
        <button id="banner-retry">重试</button>
        <button id="banner-install">安装桥接</button>
        <button id="banner-launch">启动</button>
      </div>

      <div class="transcript" id="transcript">
        <div class="empty" id="empty">
          <div class="mark">${ICONS.spark}</div>
          <h2>桌面版的 DeepSeek Harness</h2>
          <p>这个面板不内置任何模型或运行时，它直接驱动你电脑上正在运行的桌面版：同一批会话、同一批模型、同一份历史。</p>
          <ul>
            <li><kbd>Ctrl+Alt+A</kbd><span>选中代码，一键加入输入框</span></li>
            <li><kbd>Enter</kbd><span>发送，<kbd>Shift+Enter</kbd> 换行</span></li>
            <li><kbd>Ctrl+Alt+D</kbd><span>随时回到这个面板</span></li>
          </ul>
        </div>
        <div class="list" id="list"></div>
        <div class="live" id="live" hidden></div>
      </div>

      <div class="composer">
        <div class="images" id="images"></div>
        <div class="chips" id="chips"></div>
        <div class="input-wrap">
          <textarea id="input" rows="1" placeholder="问点什么…"></textarea>
          <button class="send" id="send" title="发送 (Enter)" aria-label="发送">${ICONS.send}</button>
        </div>
        <div class="toolbar">
          <button class="model-btn" id="model-btn" title="选择模型"><span class="name">模型</span><span class="caret">▾</span></button>
          <span class="spacer"></span>
          <button class="ghost" id="btn-selection" title="引用当前选区 (Ctrl+Alt+A)">引用选区</button>
        </div>
      </div>

      <div class="drawer" id="drawer" hidden>
        <div class="drawer-head">
          <span class="heading">历史会话</span>
          <button class="icon" id="drawer-close" title="关闭" aria-label="关闭历史会话">${ICONS.close}</button>
        </div>
        <div class="drawer-search"><input id="drawer-search" type="search" placeholder="搜索会话标题…" /></div>
        <div class="drawer-filter">
          <button class="seg on" id="filter-workspace">当前工作区</button>
          <button class="seg" id="filter-all">全部</button>
        </div>
        <div class="drawer-list" id="drawer-list"></div>
      </div>

      <div class="popover" id="popover" hidden>
        <div class="popover-head">模型 · 来自桌面版</div>
        <div class="popover-search"><input id="model-search" type="search" placeholder="搜索模型…" /></div>
        <div class="popover-list" id="popover-list"></div>
        <div class="effort" id="effort" hidden></div>
      </div>

      <div class="toast" id="toast" hidden></div>
    </div>
  `

  const el = (id) => document.getElementById(id)
  const dom = {
    conn: el('conn'),
    title: el('title'),
    subtitle: el('subtitle'),
    banner: el('banner'),
    bannerText: el('banner-text'),
    transcript: el('transcript'),
    empty: el('empty'),
    list: el('list'),
    live: el('live'),
    images: el('images'),
    chips: el('chips'),
    moreMenu: el('more-menu'),
    input: el('input'),
    send: el('send'),
    modelBtn: el('model-btn'),
    drawer: el('drawer'),
    drawerList: el('drawer-list'),
    drawerSearch: el('drawer-search'),
    popover: el('popover'),
    popoverList: el('popover-list'),
    modelSearch: el('model-search'),
    effort: el('effort'),
    toast: el('toast'),
  }

  let state = null
  let live = null
  let drawerOpen = false
  let modelOpen = false
  let toastTimer = null
  let stick = true
  let search = ''
  let modelSearch = ''
  let pendingImages = []
  const MAX_IMAGE_BYTES = 4 * 1024 * 1024
  const nodes = new Map()
  const saved = vscode.getState() || {}

  dom.input.value = saved.draft || ''
  resizeInput()

  // ── inbound ───────────────────────────────────────────────────────────────

  window.addEventListener('message', (event) => {
    const message = event.data
    if (!message || typeof message.type !== 'string') return

    switch (message.type) {
      case 'state':
        state = message.state
        renderAll()
        break
      case 'append':
        if (state) {
          state.items.push(message.item)
          appendNode(message.item)
          syncEmpty()
          scrollIfStuck()
        }
        break
      case 'prepend':
        if (state) {
          state.items = [...message.items, ...state.items]
          renderMessages()
        }
        break
      case 'trim':
        if (state) {
          state.items.splice(0, message.count)
          state.hasMore = true
          renderMessages()
        }
        break
      case 'update':
        if (state) {
          const index = state.items.findIndex((item) => item.id === message.item.id)
          if (index >= 0) state.items[index] = message.item
          replaceNode(message.item)
        }
        break
      case 'replace':
        if (state) {
          const index = state.items.findIndex((item) => item.id === message.fromId)
          if (index >= 0) state.items[index] = message.item
          replaceNode(message.item, message.fromId)
        }
        break
      case 'live':
        live = message.live
        renderLive()
        scrollIfStuck()
        break
      case 'status':
        if (state) state.running = message.running
        renderSend()
        renderHeader()
        break
      case 'title':
        if (state) state.sessionTitle = message.title
        renderHeader()
        if (drawerOpen) renderDrawer()
        break
      case 'hasMore':
        if (state) state.hasMore = message.value
        syncLoadOlder()
        break
      case 'sessions':
        if (state) state.sessions = message.sessions
        if (drawerOpen) renderDrawer()
        break
      case 'context':
        if (state) state.contexts.push(message.context)
        renderChips()
        break
      case 'restoreDraft':
        dom.input.value = message.text
        resizeInput()
        saveDraft()
        break
      case 'showSessions':
        setDrawer(true)
        break
      case 'focusComposer':
        dom.input.focus()
        break
      case 'toast':
        showToast(message.message, message.level)
        break
      default:
        break
    }
  })

  // ── outbound ──────────────────────────────────────────────────────────────

  el('btn-history').addEventListener('click', () => setDrawer(!drawerOpen))
  el('btn-new').addEventListener('click', () => {
    setDrawer(false)
    post({ type: 'newSession' })
  })
  el('btn-more').addEventListener('click', (event) => {
    event.stopPropagation()
    dom.moreMenu.hidden = !dom.moreMenu.hidden
  })
  el('menu-rename').addEventListener('click', () => {
    dom.moreMenu.hidden = true
    if (state && state.sessionId) post({ type: 'renameSession', sessionId: state.sessionId })
  })
  el('menu-fork').addEventListener('click', () => {
    dom.moreMenu.hidden = true
    if (state && state.sessionId) post({ type: 'forkSession', sessionId: state.sessionId })
  })
  el('banner-retry').addEventListener('click', () => post({ type: 'refresh' }))
  el('banner-install').addEventListener('click', () => post({ type: 'installBridge' }))
  el('banner-launch').addEventListener('click', () => post({ type: 'launchDesktop' }))
  el('btn-selection').addEventListener('click', () => post({ type: 'addSelection' }))
  el('drawer-close').addEventListener('click', () => setDrawer(false))
  el('model-btn').addEventListener('click', (event) => {
    event.stopPropagation()
    setModelOpen(!modelOpen)
  })
  dom.drawerSearch.addEventListener('input', () => {
    search = dom.drawerSearch.value
    renderDrawer()
  })

  dom.modelSearch.addEventListener('input', () => {
    modelSearch = dom.modelSearch.value
    renderPopover()
  })
  el('filter-workspace').addEventListener('click', () => {
    post({ type: 'setFilter', all: false })
  })
  el('filter-all').addEventListener('click', () => {
    post({ type: 'setFilter', all: true })
  })

  dom.input.addEventListener('input', () => {
    resizeInput()
    saveDraft()
  })

  dom.input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
    event.preventDefault()
    submit()
  })

  // Paste or drop an image straight into the composer.
  dom.input.addEventListener('paste', (event) => {
    const items = Array.from(event.clipboardData?.items ?? [])
    let handled = false
    for (const item of items) {
      if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
      const file = item.getAsFile()
      if (!file) continue
      event.preventDefault()
      handled = true
      void addImageFile(file)
    }
    if (handled) saveDraft()
  })

  dom.input.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types?.includes('Files')) event.preventDefault()
  })

  dom.input.addEventListener('drop', (event) => {
    const files = Array.from(event.dataTransfer?.files ?? []).filter((file) => file.type.startsWith('image/'))
    if (files.length === 0) return
    event.preventDefault()
    for (const file of files) void addImageFile(file)
  })

  dom.send.addEventListener('click', () => {
    if (state && state.running) post({ type: 'cancel' })
    else submit()
  })

  dom.transcript.addEventListener('scroll', () => {
    stick = dom.transcript.scrollHeight - dom.transcript.scrollTop - dom.transcript.clientHeight < 40
  })

  document.addEventListener('click', (event) => {
    if (modelOpen && !dom.popover.contains(event.target) && !dom.modelBtn.contains(event.target)) {
      setModelOpen(false)
    }
    if (!dom.moreMenu.hidden && !dom.moreMenu.contains(event.target) && !el('btn-more').contains(event.target)) {
      dom.moreMenu.hidden = true
    }
  })

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (modelOpen) setModelOpen(false)
      else if (!dom.moreMenu.hidden) dom.moreMenu.hidden = true
      else if (drawerOpen) setDrawer(false)
    }
  })

  dom.list.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof Element)) return

    const copyButton = target.closest('[data-copy]')
    if (copyButton) {
      const scope = copyButton.closest('.code') || copyButton.closest('.msg')
      const pre = scope && scope.querySelector('pre')
      const text = pre ? pre.textContent : scope ? scope.textContent : ''
      post({ type: 'copyText', text: text || '' })
      copyButton.textContent = '已复制'
      setTimeout(() => {
        copyButton.textContent = '复制'
      }, 1200)
      return
    }

    const link = target.closest('[data-href]')
    if (link) {
      event.preventDefault()
      post({ type: 'openExternal', url: link.getAttribute('data-href') })
      return
    }

    const chip = target.closest('[data-file]')
    if (chip) {
      post({
        type: 'openFile',
        path: chip.getAttribute('data-file'),
        line: Number(chip.getAttribute('data-line') || '0'),
      })
      return
    }

    const toolHead = target.closest('.tool-head')
    if (toolHead) {
      toolHead.parentElement.classList.toggle('open')
    }
  })

  dom.popoverList.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof Element)) return

    const pinEl = target.closest('[data-pin]')
    if (pinEl) {
      const provider = pinEl.getAttribute('data-provider')
      const model = pinEl.getAttribute('data-model')
      const effort = pinEl.getAttribute('data-effort')
      const selection = { provider, model }
      if (effort) selection.reasoningEffort = effort
      post({ type: 'pinModel', selection, pinned: !isPinned({ provider, model }) })
      return
    }

    const row = target.closest('.model-row')
    if (!row) return
    const provider = row.getAttribute('data-provider')
    const model = row.getAttribute('data-model')
    const effort = row.getAttribute('data-effort')
    const selection = { provider, model }
    if (effort) selection.reasoningEffort = effort
    post({ type: 'setModel', selection })
    const modelInfo = findModel(provider, model)
    if (!modelInfo || !modelInfo.reasoning || modelInfo.reasoning.efforts.length === 0) {
      setModelOpen(false)
    } else {
      renderPopover()
    }
  })

  dom.effort.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const button = target.closest('button[data-effort]')
    if (!button) return
    const selection = { ...(state.selection || {}) }
    selection.reasoningEffort = button.getAttribute('data-effort')
    post({ type: 'setModel', selection })
  })

  // ── render ────────────────────────────────────────────────────────────────

  function renderAll() {
    renderHeader()
    renderBanner()
    renderMessages()
    renderLive()
    renderImages()
    renderChips()
    renderModelButton()
    renderSend()
    if (drawerOpen) renderDrawer()
    if (modelOpen) renderPopover()
    scrollIfStuck(true)
  }

  function renderHeader() {
    if (!state) return
    dom.conn.className = `conn-dot ${state.connection}`
    dom.conn.title = state.connectionDetail || state.connection
    dom.title.textContent = state.sessionTitle || (state.sessionId ? '会话' : '新会话')
    const parts = []
    if (state.connection === 'connected') parts.push('已连接桌面版')
    else if (state.connection === 'connecting') parts.push('正在连接…')
    else parts.push('未连接')
    if (state.running) parts.push('生成中')
    dom.subtitle.textContent = parts.join(' · ')
    const hasSession = Boolean(state.sessionId)
    el('menu-rename').disabled = !hasSession
    el('menu-fork').disabled = !hasSession
  }

  function renderBanner() {
    if (!state) return
    const offline = state.connection === 'disconnected'
    dom.banner.hidden = !offline
    if (offline) dom.bannerText.textContent = state.connectionDetail || '未检测到桌面版 DeepSeek Harness'
  }

  function renderMessages() {
    dom.list.innerHTML = ''
    nodes.clear()
    if (!state) return
    for (const item of state.items) {
      const node = elementFor(item)
      nodes.set(item.id, node)
      dom.list.appendChild(node)
    }
    syncLoadOlder()
    syncEmpty()
    scrollIfStuck(true)
  }

  /** Keep the "load older" affordance in sync without rebuilding the transcript. */
  function syncLoadOlder() {
    const existing = dom.list.querySelector('.load-older')
    const wanted = Boolean(state && state.hasMore && state.items.length > 0)
    if (wanted && !existing) {
      const button = document.createElement('button')
      button.className = 'load-older'
      button.textContent = '加载更早的消息'
      button.addEventListener('click', () => post({ type: 'loadOlder' }))
      dom.list.insertBefore(button, dom.list.firstChild)
    } else if (!wanted && existing) {
      existing.remove()
    }
  }

  function appendNode(item) {
    const node = elementFor(item)
    nodes.set(item.id, node)
    dom.list.appendChild(node)
    scrollIfStuck()
  }

  function replaceNode(item, fromId) {
    const previous = nodes.get(fromId || item.id)
    const wasOpen = previous ? previous.classList.contains('open') : false
    const node = elementFor(item)
    if (wasOpen) node.classList.add('open')
    if (fromId) nodes.delete(fromId)
    nodes.set(item.id, node)
    if (previous && previous.parentElement) previous.replaceWith(node)
    else dom.list.appendChild(node)
  }

  function elementFor(item) {
    if (item.kind === 'user') {
      const wrap = document.createElement('div')
      wrap.className = 'msg user'
      wrap.dataset.id = item.id
      const bubble = document.createElement('div')
      bubble.className = 'bubble'
      bubble.textContent = item.text
      if (item.images && item.images.length > 0) {
        const gallery = document.createElement('div')
        gallery.className = 'images'
        for (const image of item.images) {
          if (!image.data) {
            const placeholder = document.createElement('div')
            placeholder.className = 'thumb missing'
            placeholder.textContent = '图片'
            placeholder.title = image.name
            gallery.appendChild(placeholder)
            continue
          }
          const img = document.createElement('img')
          img.className = 'attach'
          img.src = `data:${image.mediaType};base64,${image.data}`
          img.alt = image.name
          img.title = image.name
          gallery.appendChild(img)
        }
        bubble.appendChild(gallery)
      }
      wrap.appendChild(bubble)
      if (item.contexts && item.contexts.length > 0) {
        const chips = document.createElement('div')
        chips.className = 'ctx-chips'
        for (const context of item.contexts) {
          const chip = document.createElement('button')
          chip.className = 'ctx-chip'
          chip.dataset.file = context.path
          chip.dataset.line = String(context.startLine)
          chip.textContent = `${basename(context.relPath)}:${context.startLine}-${context.endLine}`
          chip.title = context.relPath
          chips.appendChild(chip)
        }
        bubble.appendChild(chips)
      }
      return wrap
    }

    if (item.kind === 'assistant') {
      const wrap = document.createElement('div')
      wrap.className = 'msg assistant'
      wrap.dataset.id = item.id

      const meta = document.createElement('div')
      meta.className = 'meta'
      if (item.model) {
        const model = document.createElement('span')
        model.className = 'model'
        model.textContent = item.model
        model.title = item.model
        meta.appendChild(model)
      }
      if (item.usage) {
        const usage = document.createElement('span')
        usage.className = 'usage'
        usage.textContent = `↑${formatTokens(item.usage.input)} ↓${formatTokens(item.usage.output)}`
        usage.title = [
          `输入 ${item.usage.input}`,
          `输出 ${item.usage.output}`,
          item.usage.total ? `总计 ${item.usage.total}` : '',
          item.usage.cacheRead ? `缓存读 ${item.usage.cacheRead}` : '',
        ].filter(Boolean).join(' · ')
        meta.appendChild(usage)
      }
      const spacer = document.createElement('span')
      spacer.className = 'spacer'
      meta.appendChild(spacer)
      const copy = document.createElement('button')
      copy.dataset.copy = '1'
      copy.textContent = '复制'
      meta.appendChild(copy)
      wrap.appendChild(meta)

      if (item.reasoning) {
        const details = document.createElement('details')
        details.className = 'reasoning'
        const summary = document.createElement('summary')
        summary.textContent = '思考过程'
        details.appendChild(summary)
        const body = document.createElement('div')
        body.className = 'md'
        body.innerHTML = renderMarkdown(item.reasoning)
        details.appendChild(body)
        wrap.appendChild(details)
      }

      const body = document.createElement('div')
      body.className = 'md'
      body.innerHTML = renderMarkdown(item.text)
      wrap.appendChild(body)

      if (item.interrupted) {
        const note = document.createElement('div')
        note.className = 'notice'
        note.textContent = '输出被中断'
        wrap.appendChild(note)
      }
      return wrap
    }

    if (item.kind === 'tool') {
      const wrap = document.createElement('div')
      wrap.className = 'tool'
      wrap.dataset.id = item.id

      const head = document.createElement('button')
      head.className = 'tool-head'
      const name = document.createElement('span')
      name.className = 'tool-name'
      name.textContent = item.name
      const view = toolView(item)
      const brief = document.createElement('span')
      brief.className = 'tool-brief'
      brief.textContent = view.brief
      brief.title = view.brief
      const status = document.createElement('span')
      status.className = `tool-status ${item.status}`
      status.textContent = item.status === 'running' ? '运行中' : item.status === 'ok' ? '完成' : '失败'
      head.append(name, brief, status)
      wrap.appendChild(head)

      const body = document.createElement('div')
      body.className = 'tool-body'
      if (view.diff && (view.diff.old.length > 0 || view.diff.new.length > 0)) {
        body.appendChild(label('改动'))
        body.appendChild(miniDiff(view.diff.old, view.diff.new))
      }
      for (const block of view.blocks) {
        body.appendChild(label(block.label))
        body.appendChild(pre(block.text))
      }
      wrap.appendChild(body)
      return wrap
    }

    const notice = document.createElement('div')
    notice.className = 'notice'
    notice.dataset.id = item.id
    notice.textContent = item.text
    return notice
  }

  function renderLive() {
    if (!live || (!live.text && !live.reasoning)) {
      dom.live.hidden = true
      dom.live.innerHTML = ''
      syncEmpty()
      return
    }
    dom.live.hidden = false
    dom.live.innerHTML = ''

    const wrap = document.createElement('div')
    wrap.className = 'msg assistant'

    const meta = document.createElement('div')
    meta.className = 'meta'
    const labelEl = document.createElement('span')
    labelEl.className = 'model'
    labelEl.textContent = modelLabel(state && state.selection)
    meta.appendChild(labelEl)
    wrap.appendChild(meta)

    if (live.reasoning) {
      const details = document.createElement('details')
      details.className = 'reasoning'
      details.open = !live.text
      const summary = document.createElement('summary')
      summary.textContent = '思考中…'
      details.appendChild(summary)
      const body = document.createElement('div')
      body.className = 'md'
      body.innerHTML = renderMarkdown(live.reasoning)
      details.appendChild(body)
      wrap.appendChild(details)
    }

    if (live.text) {
      const body = document.createElement('div')
      body.className = 'md'
      body.innerHTML = `${renderMarkdown(live.text)}<span class="caret"></span>`
      wrap.appendChild(body)
    }

    dom.live.appendChild(wrap)
    syncEmpty()
  }

  function renderChips() {
    dom.chips.innerHTML = ''
    if (!state) return
    for (const context of state.contexts) {
      const chip = document.createElement('span')
      chip.className = 'chip'
      const name = document.createElement('span')
      name.className = 'name'
      name.textContent = `${basename(context.relPath)}`
      name.title = context.relPath
      const lines = document.createElement('span')
      lines.className = 'lines'
      lines.textContent = `L${context.startLine}-${context.endLine}`
      const remove = document.createElement('button')
      remove.className = 'x'
      remove.textContent = '×'
      remove.title = '移除'
      remove.addEventListener('click', () => post({ type: 'removeContext', id: context.id }))
      chip.append(name, lines, remove)
      dom.chips.appendChild(chip)
    }
  }

  function renderImages() {
    dom.images.innerHTML = ''
    for (const image of pendingImages) {
      const thumb = document.createElement('div')
      thumb.className = 'thumb'
      thumb.title = `${image.name} · ${formatBytes(image.data.length)}`
      const img = document.createElement('img')
      img.src = `data:${image.mediaType};base64,${image.data}`
      img.alt = image.name
      const remove = document.createElement('button')
      remove.className = 'x'
      remove.textContent = '×'
      remove.title = '移除图片'
      remove.addEventListener('click', () => {
        pendingImages = pendingImages.filter((item) => item.id !== image.id)
        renderImages()
        renderSend()
      })
      thumb.append(img, remove)
      dom.images.appendChild(thumb)
    }
  }

  function addImageFile(file) {
    if (file.size > MAX_IMAGE_BYTES) {
      showToast(`图片太大（${formatBytes(file.size)}），请压缩到 4 MB 以下`, 'error')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      const comma = result.indexOf(',')
      if (comma < 0) return
      pendingImages.push({
        id: newRequestId(),
        name: file.name || '粘贴的图片',
        mediaType: file.type || 'image/png',
        data: result.slice(comma + 1),
      })
      renderImages()
      renderSend()
    }
    reader.onerror = () => showToast('读取图片失败', 'error')
    reader.readAsDataURL(file)
  }

  function formatBytes(length) {
    if (length < 1024) return `${length} B`
    if (length < 1024 * 1024) return `${(length / 1024).toFixed(1)} KB`
    return `${(length / 1024 / 1024).toFixed(2)} MB`
  }

  function renderModelButton() {
    const name = dom.modelBtn.querySelector('.name')
    if (!name) return
    const label = state ? modelLabel(state.selection) : '模型'
    name.textContent = label
    dom.modelBtn.title = `选择模型（当前：${label}）`
    dom.modelBtn.disabled = !state || state.connection !== 'connected'
    dom.modelBtn.style.opacity = dom.modelBtn.disabled ? '0.55' : '1'
  }

  function renderSend() {
    const running = state && state.running
    const disconnected = !state || state.connection === 'disconnected'
    dom.send.innerHTML = running ? ICONS.stop : ICONS.send
    dom.send.classList.toggle('stop', Boolean(running))
    dom.send.title = running ? '停止生成' : '发送 (Enter)'
    dom.send.disabled = !running && (disconnected || (dom.input.value.trim().length === 0 && pendingImages.length === 0))
  }

  function renderDrawer() {
    if (!state) return
    el('filter-workspace').classList.toggle('on', state.filterWorkspace)
    el('filter-all').classList.toggle('on', !state.filterWorkspace)

    const rows = (state.sessions || []).filter((row) => {
      if (state.filterWorkspace && state.workspace && !samePath(row.cwd, state.workspace)) return false
      if (search.trim().length > 0 && !(row.title || '').toLowerCase().includes(search.trim().toLowerCase())) return false
      return true
    })

    dom.drawerList.innerHTML = ''
    if (rows.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'drawer-empty'
      empty.textContent = state.filterWorkspace
        ? '当前工作区还没有会话。切到「全部」可以看到其它工作区的历史。'
        : '还没有任何会话。'
      dom.drawerList.appendChild(empty)
      return
    }

    let currentGroup = ''
    for (const row of rows) {
      const group = groupOf(row.updatedAt)
      if (group !== currentGroup) {
        currentGroup = group
        const label = document.createElement('div')
        label.className = 'group-label'
        label.textContent = group
        dom.drawerList.appendChild(label)
      }

      const button = document.createElement('button')
      button.className = `session-row${row.id === state.sessionId ? ' current' : ''}`
      if (row.running) {
        const dot = document.createElement('span')
        dot.className = 'live-dot'
        button.appendChild(dot)
      } else {
        const blank = document.createElement('span')
        blank.className = 'blank'
        button.appendChild(blank)
      }
      const body = document.createElement('div')
      body.className = 'body'
      const name = document.createElement('div')
      name.className = 'name'
      name.textContent = row.title || (row.blank ? '（空会话）' : '未命名会话')
      name.title = row.title || ''
      const meta = document.createElement('div')
      meta.className = 'meta'
      const time = document.createElement('span')
      time.textContent = relTime(row.updatedAt)
      meta.appendChild(time)
      if (row.cwd) {
        const cwd = document.createElement('span')
        cwd.className = 'cwd'
        cwd.textContent = basename(row.cwd)
        cwd.title = row.cwd
        meta.appendChild(cwd)
      }
      if (row.model && row.model.model) {
        const model = document.createElement('span')
        model.className = 'cwd'
        model.textContent = row.model.model.split('/').pop()
        meta.appendChild(model)
      }
      body.append(name, meta)
      button.appendChild(body)
      button.addEventListener('click', () => {
        setDrawer(false)
        post({ type: 'selectSession', sessionId: row.id })
      })
      dom.drawerList.appendChild(button)
    }
  }

  function isPinned(selection) {
    if (!selection) return false
    return (state?.pinnedModels ?? []).some((item) => item.provider === selection.provider && item.model === selection.model)
  }

  function entryOf(selection) {
    if (!selection) return null
    const model = findModel(selection.provider, selection.model)
    return {
      provider: selection.provider,
      model: selection.model,
      name: model ? model.name : selection.model,
      id: selection.model,
      reasoning: model ? model.reasoning : undefined,
      effort: selection.reasoningEffort,
    }
  }

  function renderPopover() {
    if (!state || !state.models) {
      dom.popoverList.innerHTML = '<div class="drawer-empty">还没有读到模型目录</div>'
      dom.effort.hidden = true
      return
    }
    dom.popoverList.innerHTML = ''
    const query = modelSearch.trim().toLowerCase()
    const seen = new Set()
    let shown = 0

    const matches = (entry, groupName) =>
      query.length === 0 ||
      entry.name.toLowerCase().includes(query) ||
      entry.id.toLowerCase().includes(query) ||
      groupName.toLowerCase().includes(query)

    const sections = [
      { title: '置顶', shortcut: true, entries: (state.pinnedModels ?? []).map(entryOf).filter(Boolean) },
      {
        title: '最近使用',
        shortcut: true,
        entries: (state.recentModels ?? []).map(entryOf).filter((entry) => entry && !isPinned(entry)),
      },
      ...state.models.groups.map((group) => ({
        title: group.name,
        shortcut: false,
        entries: group.models.map((model) => ({
          provider: group.id,
          model: model.id,
          name: model.name,
          id: model.id,
          reasoning: model.reasoning,
        })),
      })),
    ]

    for (const section of sections) {
      const visible = section.entries.filter((entry) => {
        const key = `${entry.provider}::${entry.model}`
        if (seen.has(key)) return false
        if (!matches(entry, section.title) && !section.shortcut) return false
        return true
      })
      if (visible.length === 0) continue

      const label = document.createElement('div')
      label.className = 'group-label'
      label.textContent = section.title
      dom.popoverList.appendChild(label)

      for (const entry of visible) {
        seen.add(`${entry.provider}::${entry.model}`)
        shown += 1
        const pinned = isPinned(entry)
        const row = document.createElement('button')
        row.className = 'model-row'
        row.dataset.provider = entry.provider
        row.dataset.model = entry.model
        row.dataset.effort = entry.effort || entry.reasoning?.defaultEffort || ''

        const name = document.createElement('span')
        name.className = 'name'
        name.textContent = entry.name
        const id = document.createElement('span')
        id.className = 'id'
        id.textContent = entry.id
        const pin = document.createElement('span')
        pin.className = `pin${pinned ? ' on' : ''}`
        pin.dataset.pin = '1'
        pin.dataset.provider = entry.provider
        pin.dataset.model = entry.model
        pin.dataset.effort = row.dataset.effort
        pin.textContent = pinned ? '★' : '☆'
        pin.title = pinned ? '取消置顶' : '置顶'
        const check = document.createElement('span')
        check.className = 'check'
        const selected = state.selection && state.selection.provider === entry.provider && state.selection.model === entry.model
        check.textContent = selected ? '✓' : ''

        row.append(name, id, pin, check)
        dom.popoverList.appendChild(row)
      }
    }

    if (shown === 0) {
      const empty = document.createElement('div')
      empty.className = 'drawer-empty'
      empty.textContent = '没有匹配的模型'
      dom.popoverList.appendChild(empty)
    }

    const selected = state.selection ? findModel(state.selection.provider, state.selection.model) : null
    const efforts = selected && selected.reasoning ? selected.reasoning.efforts : []
    if (efforts.length === 0) {
      dom.effort.hidden = true
      dom.effort.innerHTML = ''
      return
    }
    dom.effort.hidden = false
    dom.effort.innerHTML = '<span>推理强度</span>'
    for (const effort of efforts) {
      const button = document.createElement('button')
      button.dataset.effort = effort.id
      button.textContent = effort.name || effort.id
      if (state.selection && state.selection.reasoningEffort === effort.id) button.classList.add('on')
      dom.effort.appendChild(button)
    }
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  function submit() {
    if (!state) return
    if (state.running) {
      post({ type: 'cancel' })
      return
    }
    const text = dom.input.value.trim()
    if (text.length === 0 && pendingImages.length === 0) return
    if (state.connection !== 'connected') {
      showToast('还没有连接到桌面版 DeepSeek Harness', 'error')
      return
    }
    const requestId = newRequestId()
    const images = pendingImages
    pendingImages = []
    renderImages()
    post({ type: 'prompt', text, requestId, ...(images.length > 0 ? { images } : {}) })
    dom.input.value = ''
    resizeInput()
    saveDraft()
    renderSend()
  }

  function resizeInput() {
    dom.input.style.height = 'auto'
    dom.input.style.height = `${Math.min(168, dom.input.scrollHeight)}px`
    renderSend()
  }

  function saveDraft() {
    vscode.setState({ draft: dom.input.value })
  }

  function setDrawer(open) {
    drawerOpen = open
    dom.drawer.hidden = !open
    if (open) {
      renderDrawer()
      dom.drawerSearch.focus()
      setModelOpen(false)
    }
  }

  function setModelOpen(open) {
    modelOpen = open
    dom.popover.hidden = !open
    if (open) {
      modelSearch = ''
      if (dom.modelSearch) dom.modelSearch.value = ''
      renderPopover()
      if (dom.modelSearch) dom.modelSearch.focus()
    }
  }

  function showToast(message, level) {
    dom.toast.textContent = message
    dom.toast.className = `toast${level === 'info' ? ' info' : ''}`
    dom.toast.hidden = false
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => {
      dom.toast.hidden = true
    }, level === 'info' ? 3200 : 7000)
  }

  function scrollIfStuck(force) {
    if (force || stick) {
      requestAnimationFrame(() => {
        dom.transcript.scrollTop = dom.transcript.scrollHeight
      })
    }
  }

  function syncEmpty() {
    const empty = !state || (state.items.length === 0 && (!live || (!live.text && !live.reasoning)))
    dom.empty.hidden = !empty
    dom.empty.style.display = empty ? '' : 'none'
  }

  function findModel(provider, model) {
    if (!state || !state.models) return null
    const group = state.models.groups.find((entry) => entry.id === provider)
    if (!group) return null
    return group.models.find((entry) => entry.id === model) || null
  }

  function modelLabel(selection) {
    if (!selection) return '模型'
    const model = findModel(selection.provider, selection.model)
    const name = model ? model.name : selection.model
    return selection.reasoningEffort ? `${name} · ${selection.reasoningEffort}` : name
  }

  function newRequestId() {
    try {
      return crypto.randomUUID()
    } catch {
      return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`
    }
  }

  function label(text) {
    const node = document.createElement('div')
    node.className = 'label'
    node.textContent = text
    return node
  }

  function pre(text) {
    const node = document.createElement('pre')
    node.textContent = text
    return node
  }

  function pretty(text) {
    const trimmed = text.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.stringify(JSON.parse(trimmed), null, 2)
      } catch {
        return text
      }
    }
    return text
  }

  function toolBrief(args) {
    if (!args) return ''
    try {
      const parsed = JSON.parse(args)
      const candidate = parsed.path || parsed.file_path || parsed.command || parsed.query || parsed.pattern || parsed.url
      if (typeof candidate === 'string') return candidate
      const first = Object.values(parsed).find((value) => typeof value === 'string')
      if (typeof first === 'string') return first
    } catch {
      // Raw (possibly partial) JSON: show a compact prefix.
    }
    return args.replace(/\s+/g, ' ').slice(0, 90)
  }

  function basename(path) {
    if (!path) return ''
    const parts = String(path).split(/[\\/]/)
    return parts[parts.length - 1] || path
  }

  function parseArgs(args) {
    if (!args) return null
    try {
      const value = JSON.parse(args)
      return value && typeof value === 'object' ? value : null
    } catch {
      return null
    }
  }

  function shortenPath(path) {
    const value = String(path)
    const parts = value.split(/[\\/]/)
    if (parts.length <= 3) return value
    return `…/${parts.slice(-2).join('/')}`
  }

  function stripTagged(text, tag) {
    const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text || '')
    return match ? match[1].replace(/^\n/, '').replace(/\n$/, '') : text
  }

  function stripReadResult(text) {
    return stripTagged(text, 'content')
  }

  function stripShellResult(text) {
    return stripTagged(stripTagged(text, 'output'), 'stdout')
  }

  /**
   * Turn a raw tool call into presentable parts: a short header plus labelled
   * blocks (or a before/after diff for edit-style tools).
   */
  function toolView(item) {
    const args = parseArgs(item.args)
    const name = String(item.name || '').toLowerCase()
    const blocks = []
    let brief = toolBrief(item.args)
    let diff

    if (args) {
      const path = args.file_path || args.path || args.filePath || args.target_file
      if (typeof path === 'string' && path.length > 0) brief = shortenPath(path)

      const isEdit = /edit|str_replace|apply_patch|replace/.test(name)
      const isWrite = /write|create_file/.test(name)
      const isRead = /^read|read_file|view/.test(name)
      const isShell = /bash|pwsh|terminal|shell/.test(name)

      if (isRead) {
        if (item.result) blocks.push({ label: '内容', text: stripReadResult(item.result) })
      } else if (isWrite) {
        if (typeof args.content === 'string') blocks.push({ label: '写入内容', text: args.content })
        if (item.result) blocks.push({ label: '结果', text: item.result })
      } else if (isEdit) {
        if (typeof args.old_string === 'string' || typeof args.new_string === 'string') {
          diff = { old: String(args.old_string ?? ''), new: String(args.new_string ?? '') }
        }
        if (item.result) blocks.push({ label: '结果', text: item.result })
      } else if (isShell) {
        const command = args.command ?? args.cmd
        if (typeof command === 'string') {
          brief = command.split('\n')[0].slice(0, 90)
          blocks.push({ label: '命令', text: command })
        }
        if (item.result) blocks.push({ label: '输出', text: stripShellResult(item.result) })
      } else {
        if (item.args) blocks.push({ label: '参数', text: pretty(item.args) })
        if (item.result) blocks.push({ label: '结果', text: item.result })
      }
    } else {
      if (item.args) blocks.push({ label: '参数', text: item.args })
      if (item.result) blocks.push({ label: '结果', text: item.result })
    }

    return { brief, blocks: blocks.filter((block) => block.text && block.text.length > 0), diff }
  }

  function miniDiff(oldText, newText) {
    const box = document.createElement('div')
    box.className = 'diff'
    for (const line of String(oldText).split('\n')) {
      const row = document.createElement('div')
      row.className = 'del'
      row.textContent = `- ${line}`
      box.appendChild(row)
    }
    for (const line of String(newText).split('\n')) {
      const row = document.createElement('div')
      row.className = 'add'
      row.textContent = `+ ${line}`
      box.appendChild(row)
    }
    return box
  }

  function formatTokens(value) {
    const number = Number(value) || 0
    if (number < 1000) return String(number)
    if (number < 1_000_000) return `${(number / 1000).toFixed(1)}k`
    return `${(number / 1_000_000).toFixed(2)}M`
  }

  function samePath(left, right) {
    if (!left || !right) return false
    return left.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() === right.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  }

  function relTime(timestamp) {
    if (!timestamp) return ''
    const diff = Date.now() - timestamp
    if (diff < 60_000) return '刚刚'
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
    const date = new Date(timestamp)
    const today = new Date()
    if (date.getFullYear() === today.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日`
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
  }

  function groupOf(timestamp) {
    const date = new Date(timestamp)
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    if (timestamp >= startOfToday) return '今天'
    if (timestamp >= startOfToday - 86_400_000) return '昨天'
    if (timestamp >= startOfToday - 6 * 86_400_000) return '本周'
    return '更早'
  }

  // ── markdown ──────────────────────────────────────────────────────────────

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function renderMarkdown(source) {
    if (!source) return ''
    const lines = String(source).replace(/\r\n/g, '\n').split('\n')
    const out = []
    let paragraph = []
    let index = 0

    const flush = () => {
      if (paragraph.length === 0) return
      out.push(`<p>${inline(paragraph.join('\n'))}</p>`)
      paragraph = []
    }

    while (index < lines.length) {
      const line = lines[index]
      const fence = /^\s*```(\S*)\s*$/.exec(line)
      if (fence) {
        flush()
        const language = fence[1] || ''
        const code = []
        index += 1
        while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
          code.push(lines[index])
          index += 1
        }
        index += 1
        out.push(codeBlock(code.join('\n'), language))
        continue
      }

      const heading = /^(#{1,4})\s+(.*)$/.exec(line)
      if (heading) {
        flush()
        const level = heading[1].length
        out.push(`<h${level}>${inline(heading[2])}</h${level}>`)
        index += 1
        continue
      }

      if (/^\s*[-*+]\s+/.test(line)) {
        flush()
        const items = []
        while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
          items.push(`<li>${inline(lines[index].replace(/^\s*[-*+]\s+/, ''))}</li>`)
          index += 1
        }
        out.push(`<ul>${items.join('')}</ul>`)
        continue
      }

      if (/^\s*\d+\.\s+/.test(line)) {
        flush()
        const items = []
        while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
          items.push(`<li>${inline(lines[index].replace(/^\s*\d+\.\s+/, ''))}</li>`)
          index += 1
        }
        out.push(`<ol>${items.join('')}</ol>`)
        continue
      }

      if (/^>\s?/.test(line)) {
        flush()
        const quote = []
        while (index < lines.length && /^>\s?/.test(lines[index])) {
          quote.push(lines[index].replace(/^>\s?/, ''))
          index += 1
        }
        out.push(`<blockquote>${inline(quote.join('\n'))}</blockquote>`)
        continue
      }

      if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
        flush()
        out.push('<hr/>')
        index += 1
        continue
      }

      if (line.trim().length === 0) {
        flush()
        index += 1
        continue
      }

      paragraph.push(line)
      index += 1
    }

    flush()
    return out.join('')
  }

  function codeBlock(code, language) {
    return `<div class="code"><div class="code-head"><span class="lang">${escapeHtml(language || 'code')}</span><span class="spacer"></span><button data-copy="1">复制</button></div><pre><code>${escapeHtml(code)}</code></pre></div>`
  }

  function inline(text) {
    const parts = []
    const pattern = /`([^`\n]+)`/g
    let last = 0
    let match
    while ((match = pattern.exec(text)) !== null) {
      parts.push(formatSegment(text.slice(last, match.index)))
      parts.push(`<code>${escapeHtml(match[1])}</code>`)
      last = match.index + match[0].length
    }
    parts.push(formatSegment(text.slice(last)))
    return parts.join('')
  }

  function formatSegment(text) {
    let html = escapeHtml(text)
    html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    html = html.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    html = html.replace(
      /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a data-href="$2" href="#">$1</a>',
    )
    html = html.replace(/\n/g, '<br/>')
    return html
  }

  // ── boot ──────────────────────────────────────────────────────────────────

  dom.input.addEventListener('focus', () => {
    stick = true
  })

  post({ type: 'ready' })
})()
