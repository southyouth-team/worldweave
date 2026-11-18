/* Worldweave — official site interactions */
(() => {
  'use strict'

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const root = document.documentElement

  /* ---------- light / dark theme ---------- */
  const themeToggle = document.querySelector('[data-theme-toggle]')
  const themeLabel = document.querySelector('[data-theme-label]')

  function applyTheme(theme, options = {}) {
    const next = theme === 'dark' ? 'dark' : 'light'
    root.dataset.theme = next
    if (themeToggle) {
      const dark = next === 'dark'
      themeToggle.setAttribute('aria-pressed', String(dark))
      themeToggle.setAttribute('aria-label', dark ? '切换到亮色模式' : '切换到深色模式')
    }
    if (themeLabel) themeLabel.textContent = next === 'dark' ? '暗色' : '亮色'
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', next === 'dark' ? '#070c0a' : '#e4eee6')
    if (options.persist) {
      try { localStorage.setItem('worldweave-theme', next) } catch {}
    }
    if (options.animate) {
      root.classList.add('theme-transition')
      window.setTimeout(() => root.classList.remove('theme-transition'), 460)
    }
  }

  applyTheme(root.dataset.theme === 'dark' ? 'dark' : 'light')
  themeToggle?.addEventListener('click', () => {
    applyTheme(root.dataset.theme === 'dark' ? 'light' : 'dark', { persist: true, animate: true })
  })

  /* ---------- header, scroll progress, mobile nav ---------- */
  const header = document.querySelector('[data-header]')
  const progress = document.querySelector('[data-progress]')
  const navToggle = document.querySelector('[data-nav-toggle]')
  const navLinks = document.querySelector('#nav-links')
  let scrollTicking = false
  let headerIdleTimer = 0

  function updateScrollUI() {
    const y = window.scrollY || 0
    if (header) header.classList.toggle('is-scrolled', y > 24)
    if (y > 0) {
      header?.classList.add('is-scrolling')
      root.classList.add('is-scrolling')
      window.clearTimeout(headerIdleTimer)
      headerIdleTimer = window.setTimeout(() => {
        header?.classList.remove('is-scrolling')
        root.classList.remove('is-scrolling')
      }, 150)
    } else {
      header?.classList.remove('is-scrolling')
      root.classList.remove('is-scrolling')
    }
    if (progress) {
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight)
      root.style.setProperty('--scroll-progress', String(Math.min(1, y / max)))
    }
    scrollTicking = false
  }

  function requestScrollUI() {
    if (scrollTicking) return
    scrollTicking = true
    requestAnimationFrame(updateScrollUI)
  }

  window.addEventListener('scroll', requestScrollUI, { passive: true })
  window.addEventListener('resize', requestScrollUI)
  updateScrollUI()

  function closeNav() {
    if (!header) return
    header.classList.remove('nav-open')
    navToggle?.setAttribute('aria-expanded', 'false')
    navToggle?.setAttribute('aria-label', '打开导航')
  }

  navToggle?.addEventListener('click', () => {
    const open = !header.classList.contains('nav-open')
    header.classList.toggle('nav-open', open)
    navToggle.setAttribute('aria-expanded', String(open))
    navToggle.setAttribute('aria-label', open ? '关闭导航' : '打开导航')
  })

  navLinks?.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', closeNav)
  })

  document.addEventListener('click', (event) => {
    if (!header?.classList.contains('nav-open')) return
    if (!header.contains(event.target)) closeNav()
  })

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeNav()
  })

  /* ---------- reveal on scroll ---------- */
  document.querySelectorAll('.section-head, .manifesto-body, .manifesto-facts, .arch-note, .gallery-layout, .start-grid, .roadmap-grid, .footer-grid').forEach((el) => {
    if (!el.hasAttribute('data-reveal')) el.setAttribute('data-reveal', '')
  })
  const revealTargets = [...document.querySelectorAll('[data-reveal]')]
  if (!('IntersectionObserver' in window)) {
    revealTargets.forEach((el) => el.classList.add('is-visible'))
  } else {
    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        entry.target.classList.add('is-visible')
        observer.unobserve(entry.target)
      })
    }, { threshold: 0.12, rootMargin: '0px 0px -7% 0px' })
    revealTargets.forEach((el) => revealObserver.observe(el))
  }

  /* ---------- card spotlight ---------- */
  if (window.matchMedia('(hover: hover)').matches) {
    document.querySelectorAll('[data-spotlight]').forEach((card) => {
      card.addEventListener('pointermove', (event) => {
        const rect = card.getBoundingClientRect()
        card.style.setProperty('--mx', `${event.clientX - rect.left}px`)
        card.style.setProperty('--my', `${event.clientY - rect.top}px`)
      })
    })
  }

  /* ---------- hero frame follows the pointer ---------- */
  const tiltFrame = document.querySelector('[data-tilt]')
  const tiltZone = document.querySelector('.hero')
  if (tiltFrame && tiltZone && window.matchMedia('(hover: hover)').matches) {
    let tiltRaf = 0
    let pointerX = 0
    let pointerY = 0

    const applyTilt = () => {
      tiltRaf = 0
      // Neutral point is the centre of the hero, not the centre of the card.
      // The card sits on the right, so using its own centre would make it
      // lean heavily even when the pointer is in the middle of the screen.
      const rect = tiltZone.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const x = Math.max(-1, Math.min(1, (pointerX - (rect.left + rect.width / 2)) / (rect.width / 2)))
      const y = Math.max(-1, Math.min(1, (pointerY - (rect.top + rect.height / 2)) / (rect.height / 2)))
      tiltFrame.style.setProperty('--ry', `${x * 6}deg`)
      tiltFrame.style.setProperty('--rx', `${-y * 4.5}deg`)
      tiltFrame.style.setProperty('--gx', `${((x + 1) / 2) * 100}%`)
      tiltFrame.style.setProperty('--gy', `${((y + 1) / 2) * 100}%`)
    }

    const updateTilt = (clientX, clientY, pointerType) => {
      if (pointerType === 'touch') return
      pointerX = clientX
      pointerY = clientY
      if (!tiltRaf) tiltRaf = requestAnimationFrame(applyTilt)
    }

    const resetTilt = () => {
      if (tiltRaf) {
        cancelAnimationFrame(tiltRaf)
        tiltRaf = 0
      }
      tiltFrame.style.setProperty('--ry', '0deg')
      tiltFrame.style.setProperty('--rx', '0deg')
      tiltFrame.style.setProperty('--gx', '50%')
      tiltFrame.style.setProperty('--gy', '50%')
    }

    tiltZone.addEventListener('pointermove', (event) => updateTilt(event.clientX, event.clientY, event.pointerType), { passive: true })
    tiltZone.addEventListener('pointerleave', resetTilt)
    resetTilt()
  }

  /* ---------- woven hero background ---------- */
  const canvas = document.querySelector('[data-weave]')
  if (canvas) {
    const ctx = canvas.getContext('2d')
    const canvasState = {
      width: 0,
      height: 0,
      dpr: 1,
      raf: 0,
      visible: true,
      lastDraw: 0,
      start: performance.now(),
      pointerX: 0,
      pointerY: 0,
      targetX: 0,
      targetY: 0,
      particles: [],
    }

    function seedParticles() {
      const count = window.innerWidth < 700 ? 14 : 26
      canvasState.particles = Array.from({ length: count }, (_, index) => ({
        x: Math.random(),
        y: 0.18 + Math.random() * 0.67,
        size: 0.6 + Math.random() * 1.5,
        speed: 0.000018 + Math.random() * 0.00005,
        phase: index * 0.7 + Math.random() * 2,
      }))
    }

    function resizeCanvas() {
      const rect = canvas.getBoundingClientRect()
      canvasState.width = Math.max(1, rect.width)
      canvasState.height = Math.max(1, rect.height)
      canvasState.dpr = Math.min(1.5, window.devicePixelRatio || 1)
      canvas.width = Math.floor(canvasState.width * canvasState.dpr)
      canvas.height = Math.floor(canvasState.height * canvasState.dpr)
      ctx.setTransform(canvasState.dpr, 0, 0, canvasState.dpr, 0, 0)
      seedParticles()
    }

    function drawWeave(now) {
      // The weave is ambient: 30 fps is plenty and leaves the main thread
      // alone while the visitor is reading or scrolling.
      if (now - canvasState.lastDraw < 32) {
        canvasState.raf = requestAnimationFrame(drawWeave)
        return
      }
      canvasState.lastDraw = now
      const { width, height } = canvasState
      const t = now - canvasState.start
      const light = root.dataset.theme === 'light'
      const warpRgb = light ? '18, 112, 76' : '73, 230, 166'
      const weftRgb = light ? '24, 126, 164' : '69, 189, 236'
      const sparkRgb = light ? '18, 112, 76' : '186, 255, 223'
      canvasState.pointerX += (canvasState.targetX - canvasState.pointerX) * 0.045
      canvasState.pointerY += (canvasState.targetY - canvasState.pointerY) * 0.045

      ctx.clearRect(0, 0, width, height)
      ctx.globalCompositeOperation = 'lighter'

      const horizon = height * 0.57
      const bottom = height * 1.05
      const columns = width < 700 ? 14 : 26
      const rows = width < 700 ? 9 : 15
      const centerX = width * 0.54 + canvasState.pointerX * 12

      // Warp: vertical threads converging toward the horizon.
      for (let index = 0; index <= columns; index += 1) {
        const p = index / columns
        const baseX = -width * 0.12 + width * 1.24 * p
        const topX = centerX + (baseX - centerX) * 0.1 + Math.sin(t * 0.00012 + index * 0.6) * 2.5
        const topY = horizon + Math.sin(t * 0.00018 + index * 0.42) * 3
        const gradient = ctx.createLinearGradient(0, topY, 0, bottom)
        const alpha = 0.045 + Math.abs(p - 0.5) * 0.06
        gradient.addColorStop(0, `rgba(${warpRgb}, ${alpha})`)
        gradient.addColorStop(0.55, `rgba(${warpRgb}, ${alpha * 1.7})`)
        gradient.addColorStop(1, `rgba(${weftRgb}, ${alpha * 0.25})`)
        ctx.strokeStyle = gradient
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(topX, topY)
        ctx.lineTo(baseX + canvasState.pointerX * 5, bottom)
        ctx.stroke()
      }

      // Weft: horizontal threads gently waving across the fabric.
      for (let index = 0; index <= rows; index += 1) {
        const p = index / rows
        const y = horizon + (bottom - horizon) * Math.pow(p, 2.25)
        const amplitude = 1.5 + p * 9
        const alpha = 0.045 + p * 0.12
        ctx.strokeStyle = `rgba(${weftRgb}, ${alpha})`
        ctx.lineWidth = p > 0.72 ? 1.15 : 0.85
        ctx.beginPath()
        const steps = width < 700 ? 24 : 44
        for (let step = 0; step <= steps; step += 1) {
          const x = (step / steps) * width
          const wave = Math.sin(x * 0.007 + t * 0.00035 + index * 0.48) * amplitude
          const yPoint = y + wave
          if (step === 0) ctx.moveTo(x, yPoint)
          else ctx.lineTo(x, yPoint)
        }
        ctx.stroke()
      }

      // Horizon thread.
      const horizonGradient = ctx.createLinearGradient(width * 0.18, 0, width * 0.82, 0)
      horizonGradient.addColorStop(0, `rgba(${warpRgb}, 0)`)
      horizonGradient.addColorStop(0.42, `rgba(${warpRgb}, 0.22)`)
      horizonGradient.addColorStop(0.58, `rgba(${weftRgb}, 0.18)`)
      horizonGradient.addColorStop(1, `rgba(${weftRgb}, 0)`)
      ctx.strokeStyle = horizonGradient
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(width * 0.16, horizon + 1)
      ctx.lineTo(width * 0.84, horizon + 1)
      ctx.stroke()

      // Floating sparks above the weave.
      for (const particle of canvasState.particles) {
        const x = particle.x * width + Math.sin(t * particle.speed + particle.phase) * 24
        const y = particle.y * height + Math.cos(t * particle.speed * 1.3 + particle.phase) * 12
        const twinkle = 0.32 + Math.sin(t * 0.0011 + particle.phase) * 0.25
        ctx.fillStyle = `rgba(${sparkRgb}, ${Math.max(0.08, twinkle) * 0.55})`
        ctx.beginPath()
        ctx.arc(x, y, particle.size, 0, Math.PI * 2)
        ctx.fill()
      }

      ctx.globalCompositeOperation = 'source-over'
      canvasState.raf = requestAnimationFrame(drawWeave)
    }

    resizeCanvas()
    const resizeObserver = new ResizeObserver(resizeCanvas)
    resizeObserver.observe(canvas)
    window.addEventListener('pointermove', (event) => {
      canvasState.targetX = (event.clientX / window.innerWidth - 0.5) * 2
      canvasState.targetY = (event.clientY / window.innerHeight - 0.5) * 2
    }, { passive: true })

    function startCanvas() {
      if (canvasState.raf || document.hidden || !canvasState.visible) return
      canvasState.raf = requestAnimationFrame(drawWeave)
    }

    function stopCanvas() {
      if (!canvasState.raf) return
      cancelAnimationFrame(canvasState.raf)
      canvasState.raf = 0
    }

    if ('IntersectionObserver' in window) {
      const canvasObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          canvasState.visible = entry.isIntersecting
          if (canvasState.visible) startCanvas()
          else stopCanvas()
        })
      }, { threshold: 0.02 })
      canvasObserver.observe(canvas)
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopCanvas()
      else startCanvas()
    })

    // Do not compete with scrolling: freeze the ambient weave while the
    // viewport is moving, then resume once scrolling settles.
    let resumeCanvasTimer = 0
    window.addEventListener('scroll', () => {
      stopCanvas()
      window.clearTimeout(resumeCanvasTimer)
      resumeCanvasTimer = window.setTimeout(() => {
        if (canvasState.visible && !document.hidden) startCanvas()
      }, 160)
    }, { passive: true })

    startCanvas()

  }

  /* ---------- world time stage ---------- */
  const timeStage = document.querySelector('[data-time-stage]')
  if (timeStage) {
    const timeButtons = [...document.querySelectorAll('[data-time-button]')]
    const readout = document.querySelector('[data-time-readout]')
    const phaseLabel = document.querySelector('[data-time-phase]')
    const sunAlt = document.querySelector('[data-sun-alt]')
    const phases = {
      dawn: { time: '06:18', label: '清晨 · 16°C · 薄雾', alt: '4°' },
      noon: { time: '12:06', label: '正午 · 29°C · 晴朗', alt: '67°' },
      dusk: { time: '18:42', label: '黄昏 · 24°C · 微风', alt: '12°' },
      night: { time: '00:12', label: '深夜 · 18°C · 星空', alt: '-32°' },
    }
    let activePhase = timeStage.dataset.phase || 'dusk'
    let autoTimer = null
    let userPinned = reduceMotion
    let stageVisible = false

    function setPhase(phase, options = {}) {
      if (!phases[phase]) return
      activePhase = phase
      timeStage.dataset.phase = phase
      timeButtons.forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.timeButton === phase))
      })
      if (readout) readout.textContent = phases[phase].time
      if (phaseLabel) phaseLabel.textContent = phases[phase].label
      if (sunAlt) sunAlt.textContent = phases[phase].alt
      if (options.user) {
        userPinned = true
        stopAuto()
      }
    }

    function advancePhase() {
      const order = ['dawn', 'noon', 'dusk', 'night']
      const next = order[(order.indexOf(activePhase) + 1) % order.length]
      setPhase(next)
    }

    function startAuto() {
      if (reduceMotion || userPinned || autoTimer || !stageVisible || document.hidden) return
      autoTimer = window.setInterval(advancePhase, 7200)
    }

    function stopAuto() {
      if (!autoTimer) return
      window.clearInterval(autoTimer)
      autoTimer = null
    }

    timeButtons.forEach((button) => {
      button.addEventListener('click', () => setPhase(button.dataset.timeButton, { user: true }))
    })

    if ('IntersectionObserver' in window) {
      const stageObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          stageVisible = entry.isIntersecting
          if (stageVisible) startAuto()
          else stopAuto()
        })
      }, { threshold: 0.35 })
      stageObserver.observe(timeStage)
    }

    timeStage.addEventListener('pointerenter', stopAuto)
    timeStage.addEventListener('pointerleave', () => {
      if (!userPinned) startAuto()
    })

    setPhase(activePhase)
  }

  /* ---------- gallery tabs ---------- */
  const galleryTabs = [...document.querySelectorAll('[data-gallery]')]
  const galleryPanel = document.querySelector('#gallery-panel')
  const galleryImage = document.querySelector('[data-gallery-image]')
  const galleryUrl = document.querySelector('[data-gallery-url]')
  const galleryTitle = document.querySelector('[data-gallery-title]')
  const galleryNote = document.querySelector('[data-gallery-note]')
  const galleryData = {
    home: {
      src: 'assets/homepage.webp',
      alt: 'Worldweave 首页，展示一个已发布的三维世界',
      url: 'worldweave /',
      title: '一个世界，被认真确认之后才出现在这里。',
      note: '访客看到的是管理员审核通过后冻结的版本。',
      width: 1280,
      height: 800,
    },
    sandbox: {
      src: 'assets/sandbox.webp',
      alt: 'Worldweave 世界沙盒，左侧是世界空间与角色面板，右侧是三维编辑场景',
      url: 'worldweave /world-sandbox-mvp',
      title: '你的工作台：地块、道路、模型和环境都在这一屏。',
      note: '成员在这里编辑世界，完成后提交发布申请。',
      width: 1280,
      height: 860,
    },
    model: {
      src: 'assets/model-editor.webp',
      alt: 'Worldweave AI 模型工作台，展示对话式生成、模型预览与部件编辑',
      url: 'worldweave /model-editor',
      title: '一句描述，从体块长成一栋可以继续微调的建筑。',
      note: '分阶段生成、视觉质检、部件选择和局部修改在同一个工作台完成。',
      width: 1280,
      height: 800,
    },
    review: {
      src: 'assets/publish-review.webp',
      alt: 'Worldweave 发布审核界面，管理员在三维视图中查看提交的世界快照',
      url: 'worldweave /admin / publish',
      title: '审核不是看一张缩略图，而是走进去看提交的世界。',
      note: '模型、位置、地块范围和说明都跟着冻结快照一起提交。',
      width: 1280,
      height: 800,
    },
    admin: {
      src: 'assets/admin.webp',
      alt: 'Worldweave 管理后台，包含加入申请、发布审核、团队成员和站点设置',
      url: 'worldweave /admin',
      title: '成员、申请、发布、站点设置，都在同一套后台里。',
      note: '管理员专注管理与审核，不进入模型编辑器。',
      width: 1280,
      height: 800,
    },
  }

  let galleryRequest = 0

  function selectGallery(key, options = {}) {
    const item = galleryData[key]
    if (!item || !galleryImage) return
    const request = ++galleryRequest
    galleryTabs.forEach((tab) => {
      const selected = tab.dataset.gallery === key
      tab.setAttribute('aria-selected', String(selected))
      tab.tabIndex = selected ? 0 : -1
      if (selected && options.focus) tab.focus()
    })
    if (galleryPanel) galleryPanel.classList.add('is-switching')

    const preload = new Image()
    let swapped = false
    function swap() {
      if (swapped || request !== galleryRequest) return
      swapped = true
      galleryImage.src = item.src
      galleryImage.alt = item.alt
      galleryImage.width = item.width
      galleryImage.height = item.height
      if (galleryUrl) galleryUrl.textContent = item.url
      if (galleryTitle) galleryTitle.textContent = item.title
      if (galleryNote) galleryNote.textContent = item.note
      if (galleryPanel) {
        const tab = galleryTabs.find((entry) => entry.dataset.gallery === key)
        if (tab) galleryPanel.setAttribute('aria-labelledby', tab.id)
        requestAnimationFrame(() => galleryPanel.classList.remove('is-switching'))
      }
    }
    preload.addEventListener('load', swap, { once: true })
    preload.addEventListener('error', swap, { once: true })
    preload.src = item.src
    window.setTimeout(swap, 800)
  }

  galleryTabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectGallery(tab.dataset.gallery))
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      let next = index
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % galleryTabs.length
      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index - 1 + galleryTabs.length) % galleryTabs.length
      if (event.key === 'Home') next = 0
      if (event.key === 'End') next = galleryTabs.length - 1
      selectGallery(galleryTabs[next].dataset.gallery, { focus: true })
    })
  })

  /* ---------- quick start tabs + copy ---------- */
  const startTabs = [...document.querySelectorAll('[data-start-tab]')]
  const startPanels = [...document.querySelectorAll('[data-start-panel]')]
  const copyButton = document.querySelector('[data-copy]')

  function selectStartTab(key) {
    startTabs.forEach((tab) => {
      const selected = tab.dataset.startTab === key
      tab.setAttribute('aria-selected', String(selected))
      tab.tabIndex = selected ? 0 : -1
    })
    startPanels.forEach((panel) => {
      panel.hidden = panel.dataset.startPanel !== key
    })
    if (copyButton) copyButton.dataset.copy = key === 'docker' ? '#code-docker' : '#code-local'
  }

  startTabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectStartTab(tab.dataset.startTab))
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      let next = index
      if (event.key === 'ArrowRight') next = (index + 1) % startTabs.length
      if (event.key === 'ArrowLeft') next = (index - 1 + startTabs.length) % startTabs.length
      if (event.key === 'Home') next = 0
      if (event.key === 'End') next = startTabs.length - 1
      selectStartTab(startTabs[next].dataset.startTab)
      startTabs[next].focus()
    })
  })

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }

  copyButton?.addEventListener('click', async () => {
    const selector = copyButton.dataset.copy || '#code-docker'
    const source = document.querySelector(selector)
    if (!source) return
    const text = source.innerText.replace(/\s+$/g, '')
    const original = copyButton.textContent
    try {
      await copyText(text)
      copyButton.textContent = '已复制'
    } catch {
      copyButton.textContent = '复制失败'
    }
    window.setTimeout(() => { copyButton.textContent = original }, 1800)
  })

  /* ---------- footer year ---------- */
  document.querySelectorAll('[data-year]').forEach((el) => {
    el.textContent = String(new Date().getFullYear())
  })
})()
