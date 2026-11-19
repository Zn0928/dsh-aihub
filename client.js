window.__ModuleLoader__.load({
  id: 'dsh-aihub',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const styles = {
      wrap: { maxWidth: 760, margin: '0 auto', padding: '4px 2px 32px' },
      title: { fontSize: 20, fontWeight: 600, margin: '0 0 4px' },
      sub: { fontSize: 13, color: 'var(--dsw-alias-label-tertiary, #9aa0aa)', margin: '0 0 18px', lineHeight: 1.7 },
      card: {
        border: '1px solid var(--dsw-alias-border-l2, #3a3d45)',
        borderRadius: 12,
        background: 'var(--dsw-alias-bg-layer-2, #23252b)',
        padding: '14px 16px',
        marginBottom: 12,
      },
      head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
      headLeft: { display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0, flexWrap: 'wrap' },
      name: { fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap' },
      badge: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary, #9aa0aa)', whiteSpace: 'nowrap' },
      meta: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary, #9aa0aa)', marginTop: 6, lineHeight: 1.8, wordBreak: 'break-word' },
      quota: { fontSize: 14, marginTop: 8, lineHeight: 1.8, fontVariantNumeric: 'tabular-nums', wordBreak: 'break-word' },
      select: {
        width: '100%',
        marginTop: 10,
        padding: '7px 10px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2, #3a3d45)',
        background: 'var(--dsw-alias-bg-layer-1, #191b20)',
        color: 'var(--dsw-alias-label-primary, #e8e9ed)',
        fontSize: 13,
      },
      input: {
        width: '100%',
        marginTop: 8,
        padding: '7px 10px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2, #3a3d45)',
        background: 'var(--dsw-alias-bg-layer-1, #191b20)',
        color: 'var(--dsw-alias-label-primary, #e8e9ed)',
        fontSize: 13,
      },
      actions: { display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center', flexWrap: 'wrap' },
      modeRow: { display: 'grid', gridTemplateColumns: '110px 1fr', gap: 10, alignItems: 'center', marginTop: 10 },
      modeLabel: { fontSize: 13, color: 'var(--dsw-alias-label-secondary, #c6c9d0)', whiteSpace: 'nowrap' },
      num: {
        width: 92,
        marginLeft: 4,
        padding: '4px 8px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-l2, #3a3d45)',
        background: 'var(--dsw-alias-bg-layer-1, #191b20)',
        color: 'var(--dsw-alias-label-primary, #e8e9ed)',
        fontSize: 13,
      },
      btn: {
        minWidth: 34,
        height: 30,
        padding: '0 10px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2, #3a3d45)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary, #e8e9ed)',
        cursor: 'pointer',
      },
      btnOff: { opacity: 0.35, cursor: 'default' },
      btnWarn: { borderColor: 'var(--dsw-alias-warning, #f0a35e)', color: 'var(--dsw-alias-warning, #f0a35e)' },
      warn: { marginTop: 8, padding: '8px 10px', borderRadius: 8, fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-warning, #f0a35e)', background: 'var(--dsw-alias-fill-l2, rgba(240,163,94,0.10))' },
      loginLink: { color: 'var(--dsw-alias-brand, #7c9cff)', textDecoration: 'underline', cursor: 'pointer', marginLeft: 4 },
      primary: {
        height: 30,
        padding: '0 16px',
        borderRadius: 8,
        border: 0,
        background: '#2b6cb0',
        color: '#fff',
        cursor: 'pointer',
      },
      save: {
        marginTop: 4,
        height: 34,
        padding: '0 18px',
        borderRadius: 8,
        border: 0,
        background: '#2b6cb0',
        color: '#fff',
        cursor: 'pointer',
        fontSize: 14,
      },
      err: { color: 'var(--dsw-alias-warning, #f0a35e)' },
      foot: { marginTop: 16, fontSize: 12, color: 'var(--dsw-alias-label-tertiary, #9aa0aa)', lineHeight: 1.9, wordBreak: 'break-word' },
      code: { padding: '1px 5px', borderRadius: 4, background: 'var(--dsw-alias-bg-layer-3, #2a2d34)' },
      msg: { marginLeft: 10, fontSize: 13, color: 'var(--dsw-alias-label-secondary, #c6c9d0)' },
    }

    function num(n) {
      if (typeof n !== 'number' || !Number.isFinite(n)) return '-'
      return Math.round(n * 100) / 100
    }

    function kTokens(n) {
      return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n / 1000) : ''
    }

    async function getJson(url, init) {
      const response = await fetch(url, Object.assign({ cache: 'no-store', headers: { accept: 'application/json' } }, init))
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error((payload && payload.error) || ('HTTP ' + response.status))
      return payload
    }

    function providerCredits(id, qoder, trae, codearts) {
      if (id === 'qoder') {
        if (!qoder || !qoder.connected) return { text: '未授权 Qoder', ok: false }
        const rows = (qoder.credits && qoder.credits.rows) || []
        if (rows.length === 0) return { text: '已授权 · 无额度数据', ok: true }
        return { text: rows.map((row) => row.label + '：' + num(row.remaining) + ' / ' + num(row.total)).join('    '), ok: true }
      }
      if (id === 'trae') {
        const accounts = (trae && trae.accounts) || []
        if (accounts.length === 0) return { text: '未找到 Trae 登录', ok: false }
        const cn = accounts.find((account) => account.edition === 'cn') || accounts[0]
        if (cn.credits && cn.credits.kind === 'credits') {
          return { text: '可用 ' + num(cn.credits.available) + ' / ' + num(cn.credits.total) + '（通用 ' + num(cn.credits.generalAvailable) + '，Work ' + num(cn.credits.workAvailable) + '）', ok: true }
        }
        if (cn.credits && cn.credits.kind === 'subscription') return { text: '订阅' + (cn.credits.plan ? '：' + cn.credits.plan : ''), ok: true }
        return { text: '需在 Trae 客户端重新登录', ok: false }
      }
      if (id === 'codearts') {
        const accounts = (codearts && codearts.accounts) || []
        if (accounts.length === 0) return { text: '未登录 CodeArts', ok: false }
        const account = accounts[0]
        if (account.credits) {
          return { text: (account.credits.planName || '') + ' 剩余 ' + num(account.credits.remain) + ' / ' + num(account.credits.total) + (account.credits.periodEnd ? '（到期 ' + account.credits.periodEnd + '）' : ''), ok: true }
        }
        return { text: '额度读取失败', ok: false }
      }
      return { text: '', ok: false }
    }

    function providerStatus(id, qoder, trae, codearts) {
      if (id === 'qoder') return qoder && qoder.connected ? '已连接' : '未连接'
      if (id === 'trae') return trae && trae.accounts && trae.accounts.length > 0 ? '本机登录' : '未找到登录'
      if (id === 'codearts') return codearts && codearts.accounts && codearts.accounts.length > 0 ? '本机账号' : '未登录'
      return ''
    }

    function HubPage() {
      const [state, setState] = React.useState(null)
      const [modes, setModes] = React.useState([])
      const [useMax, setUseMax] = React.useState(true)
      const [qoder, setQoder] = React.useState(null)
      const [trae, setTrae] = React.useState(null)
      const [codearts, setCodearts] = React.useState(null)
      const [qoderCheckin, setQoderCheckin] = React.useState(null)
      const [traeCheckin, setTraeCheckin] = React.useState(null)
      const [codeartsCheckin, setCodeartsCheckin] = React.useState(null)
      /** Authorization URL from the last "华为云登录" attempt; the desktop shell
       *  blocks window.open, so the card shows it as a clickable link. */
      const [loginUrl, setLoginUrl] = React.useState(null)
      const [failure, setFailure] = React.useState(null)
      const [message, setMessage] = React.useState('')
      const [pat, setPat] = React.useState('')
      const [busy, setBusy] = React.useState(false)

      const load = React.useCallback(() => {
        getJson('/aihub/api/state').then((value) => {
          setState(value)
          setUseMax(value.useMaxContextWindow !== false)
          setModes((value.chains || [])
            .filter((chain) => chain.model !== 'selftest')
            .map((chain) => ({
              model: chain.model,
              label: chain.name || chain.model,
              contextWindow: chain.contextWindow,
              maxTokens: chain.maxTokens,
              pinned: chain.pinned === true,
              targets: (chain.targets || []).slice(),
            })))
        }).catch((error) => setFailure('读取配置失败：' + String(error.message || error)))
        getJson('/aihub/qoder/state').then(setQoder).catch(() => setQoder({ connected: false }))
        getJson('/aihub/trae/state').then(setTrae).catch(() => setTrae({ accounts: [] }))
        getJson('/aihub/codearts/state').then(setCodearts).catch(() => setCodearts({ accounts: [] }))
        getJson('/aihub/qoder/checkin').then(setQoderCheckin).catch(() => setQoderCheckin(null))
        getJson('/aihub/trae/checkin').then(setTraeCheckin).catch(() => setTraeCheckin(null))
        getJson('/aihub/codearts/checkin').then(setCodeartsCheckin).catch(() => setCodeartsCheckin(null))
      }, [])

      React.useEffect(() => { load() }, [load])

      const write = (next) => setState(Object.assign({}, state, { providers: next }))

      const claimQoder = () => {
        setMessage('签到中…')
        getJson('/aihub/qoder/checkin', { method: 'POST' })
          .then((result) => {
            setQoderCheckin(result)
            setMessage(result.status === 'claimed' ? `已签到 +${result.amount ?? ''}`
              : result.status === 'already-claimed' ? '今天已签到'
                : result.status === 'before-window' ? '今日窗口还没开' : '签到未成功')
            setTimeout(() => setMessage(''), 3000)
            getJson('/aihub/qoder/state').then(setQoder).catch(() => {})
          })
          .catch((error) => setFailure('Qoder 签到失败：' + String(error.message || error)))
      }

      const claimTrae = () => {
        setMessage('签到中…')
        getJson('/aihub/trae/checkin', { method: 'POST' })
          .then((result) => {
            setTraeCheckin({ ...result, status: result.claimed ? 'claimed' : 'failed' })
            setMessage(result.claimed ? 'Trae 已签到' : ('签到未成功' + (result.message ? '：' + result.message : '')))
            setTimeout(() => setMessage(''), 3000)
          })
          .catch((error) => setFailure('Trae 签到失败：' + String(error.message || error)))
      }

      const claimCodearts = () => {
        setMessage('签到中…')
        getJson('/aihub/codearts/checkin', { method: 'POST' })
          .then((result) => {
            setCodeartsCheckin(result)
            setMessage(result.status === 'claimed' ? `CodeArts 已签到 +${result.amount ?? ''}`
              : result.status === 'already-claimed' ? 'CodeArts 今天已签到'
                : ('签到未成功' + (result.message ? '：' + result.message : '')))
            setTimeout(() => setMessage(''), 3000)
            getJson('/aihub/codearts/state').then(setCodearts).catch(() => {})
          })
          .catch((error) => setFailure('CodeArts 签到失败：' + String(error.message || error)))
      }

      const refreshCodeartsState = () => getJson('/aihub/codearts/state').then(setCodearts).catch(() => {})

      /**
       * Poll the delegated login until it settles. The backend hands back the
       * authorization URL it used, which is also the key the CodeArts service
       * tracks the attempt under.
       */
      const watchCodeartsLogin = (url) => {
        let tries = 0
        const tick = () => {
          tries += 1
          getJson('/aihub/codearts/login/status?url=' + encodeURIComponent(url))
            .then((result) => {
              if (result.status === 'done') {
                setLoginUrl(null)
                setMessage(result.credits
                  ? 'CodeArts 登录成功，剩余 ' + num(result.credits.remain) + ' / ' + num(result.credits.total)
                  : 'CodeArts 登录成功')
                setTimeout(() => setMessage(''), 5000)
                return refreshCodeartsState()
              }
              if (result.status === 'error') {
                setLoginUrl(null)
                setMessage('CodeArts 登录失败：' + String(result.error || '').slice(0, 80))
                setTimeout(() => setMessage(''), 6000)
                return refreshCodeartsState()
              }
              if (result.status === 'idle') {
                setMessage('登录窗口已关闭，未完成授权')
                setTimeout(() => setMessage(''), 4000)
                return undefined
              }
              if (tries < 100) setTimeout(tick, 3000)
              return undefined
            })
            .catch(() => { if (tries < 100) setTimeout(tick, 3000) })
        }
        setTimeout(tick, 2000)
      }

      /**
       * Two-stage re-login. The cheap path reuses whatever token the CodeArts
       * client already holds; only when that fails do we open a browser and let
       * the user authorize Huawei Cloud directly.
       */
      const reloginCodearts = (interactive) => {
        if (interactive === true) {
          setMessage('正在获取华为云授权链接…')
          getJson('/aihub/codearts/login', { method: 'POST' })
            .then((result) => {
              if (result.status !== 'started' || typeof result.url !== 'string') {
                setMessage('无法发起登录：' + String(result.error || '未知原因').slice(0, 90))
                setTimeout(() => setMessage(''), 6000)
                return undefined
              }
              // The desktop shell blocks window.open, so surface the link on the
              // card as well: an ordinary click on a rendered anchor still works.
              try { window.open(result.url, '_blank', 'noopener') } catch { /* the link stays */ }
              setLoginUrl(result.url)
              setMessage('授权页已就绪：点下面的链接打开，登录完成后本卡片会自动更新')
              watchCodeartsLogin(result.url)
              return undefined
            })
            .catch((error) => setFailure('发起 CodeArts 登录失败：' + String(error.message || error)))
          return
        }
        setMessage('重新登录中…')
        getJson('/aihub/codearts/relogin', { method: 'POST' })
          .then((result) => {
            if (result.status === 'imported') setMessage('已从 CodeArts 客户端导入最新登录')
            else if (result.status === 'refreshed') setMessage('CodeArts 登录已刷新')
            else if (result.status === 'unauthorized') setMessage('本机没有 CodeArts 账号，请点「华为云登录」')
            else {
              setMessage('自动续期失败，请点「华为云登录」重新授权')
              if (globalThis.console) console.warn('[aihub] codearts relogin failed:', result.error)
            }
            setTimeout(() => setMessage(''), 5000)
            return refreshCodeartsState()
          })
          .catch((error) => {
            setFailure('CodeArts 重新登录失败：' + String(error.message || error))
            return refreshCodeartsState()
          })
      }

      const save = () => {
        const providers = (state.providers || []).map((p) => {
          const list = p.models || []
          const model = list.find((entry) => entry.id === p.model) || list[0] || {}
          return {
            id: p.id,
            label: p.label,
            model: p.model,
            defaultContextWindow: model.defaultContextWindow ?? model.contextWindow ?? 0,
            maxContextWindow: model.maxContextWindow ?? model.contextWindow ?? 0,
          }
        })
        setMessage('保存中…')
        getJson('/aihub/api/config', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ providers, modes, useMaxContextWindow: useMax }),
        }).then(() => {
          setMessage('已保存，插件重载中…')
          setTimeout(() => { load(); setMessage('') }, 1500)
        }).catch((error) => {
          setMessage('')
          setFailure('保存失败：' + String(error.message || error))
        })
      }

      const connectQoder = () => {
        if (busy) return
        setBusy(true)
        setMessage('授权中…')
        getJson('/aihub/qoder/connect', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pat: pat.trim() }),
        }).then((value) => {
          setQoder(value)
          setPat('')
          setMessage('已连接')
          setTimeout(() => setMessage(''), 2000)
        }).catch((error) => {
          setMessage('')
          setFailure('Qoder 授权失败：' + String(error.message || error))
        }).finally(() => setBusy(false))
      }

      if (state === null) {
        return h('div', { style: styles.wrap }, h('p', { style: styles.err }, failure || '加载中…'))
      }

      const providers = Array.isArray(state.providers) ? state.providers : []

      const modelWindow = (provider) => {
        const list = provider.models || []
        const model = list.find((entry) => entry.id === provider.model) || list[0]
        if (!model) return Number(provider.contextWindow) || 0
        return useMax
          ? (model.maxContextWindow ?? model.contextWindow ?? 0)
          : (model.defaultContextWindow ?? model.contextWindow ?? 0)
      }

      const cardHead = (label, status, actions) => h('div', { style: styles.head },
        h('div', { style: styles.headLeft },
          h('div', { style: styles.name }, label),
          status ? h('div', { style: styles.badge }, status) : null,
        ),
        actions,
      )

      // ---- 平台卡片：顺序 + 模型选择 ----
      const platformCards = providers.map((p, index) => {
        const credits = providerCredits(p.id, qoder, trae, codearts)
        const status = providerStatus(p.id, qoder, trae, codearts)
        const models = (p.models || []).slice()
        if (p.model && !models.some((model) => model.id === p.model)) models.unshift({ id: p.model, name: p.model })
        const move = (delta) => {
          const target = index + delta
          if (target < 0 || target >= providers.length) return
          const next = providers.slice()
          const tmp = next[index]
          next[index] = next[target]
          next[target] = tmp
          write(next)
        }
        const choose = (model) => {
          const next = providers.slice()
          next[index] = Object.assign({}, next[index], { model })
          write(next)
        }
        return h('div', { key: p.id + '-' + index, style: styles.card },
          cardHead('#' + (index + 1) + '  ' + (p.label || p.id), status,
            h('div', { style: styles.actions },
              h('button', { style: Object.assign({}, styles.btn, index === 0 ? styles.btnOff : {}), onClick: () => move(-1), title: '上移' }, '↑'),
              h('button', { style: Object.assign({}, styles.btn, index === providers.length - 1 ? styles.btnOff : {}), onClick: () => move(1), title: '下移' }, '↓'),
            )),
          h('div', { style: credits.ok ? styles.quota : Object.assign({}, styles.quota, styles.err) }, credits.text),
          models.length > 0
            ? h('select', {
              style: styles.select,
              value: p.model || (models[0] && models[0].id) || '',
              onChange: (event) => choose(event.target.value),
            }, models.map((model) => h('option', { key: model.id, value: model.id },
              model.name
              + (Number.isFinite(model.priceFactor) ? '  · x' + model.priceFactor : '')
              + '   (' + model.id + ')',
            )))
            : h('div', { style: styles.meta }, '暂无可用模型'),
          h('div', { style: styles.modeRow },
            h('div', { style: styles.modeLabel }, '上下文'),
            h('div', { style: styles.meta },
              (kTokens(modelWindow(p)) || '目录默认') + ' K'
              + (Number(p.contextWindow) > 0 && kTokens(p.contextWindow) !== kTokens(modelWindow(p)) ? '（按' + (useMax ? '最大' : '默认') + '窗口）' : ''),
            ),
          ),
        )
      })

      // ---- 模式配置：每个模式自己的模型链与上下文 ----
      const modeCards = modes.map((mode, modeIndex) => {
        const update = (patch) => {
          const next = modes.slice()
          next[modeIndex] = Object.assign({}, mode, patch)
          setModes(next)
        }
        const providerRows = providers.map((p) => {
          const prefix = p.id + '/'
          const target = (mode.targets || []).find((entry) => entry.startsWith(prefix))
          const current = target !== undefined ? target.slice(prefix.length) : (p.model || '')
          const list = (p.models || []).slice()
          if (current && !list.some((model) => model.id === current)) list.unshift({ id: current, name: current })
          const choose = (value) => {
            const targets = (mode.targets || []).slice()
            const index = targets.findIndex((entry) => entry.startsWith(prefix))
            if (index >= 0) targets[index] = prefix + value
            else {
              const firstFallback = targets.findIndex((entry) => !providers.some((provider) => entry.startsWith(provider.id + '/')))
              targets.splice(firstFallback === -1 ? targets.length : firstFallback, 0, prefix + value)
            }
            update({ targets })
          }
          return h('div', { key: p.id, style: styles.modeRow },
            h('div', { style: styles.modeLabel }, p.label || p.id),
            list.length > 0
              ? h('select', { style: styles.select, value: current, onChange: (event) => choose(event.target.value) },
                list.map((model) => h('option', { key: model.id, value: model.id },
                  model.name + (Number.isFinite(model.priceFactor) ? ' · x' + model.priceFactor : '') + '  (' + model.id + ')')))
              : h('div', { style: styles.meta }, '暂无模型'),
          )
        })
        const fallbackTargets = (mode.targets || []).filter((entry) => !providers.some((p) => entry.startsWith(p.id + '/')))
        const windows = providers
          .filter((p) => (mode.targets || []).some((entry) => entry.startsWith(p.id + '/')))
          .map(modelWindow)
          .filter((value) => value > 0)
        const modeWindow = windows.length > 0 ? Math.min(...windows) : mode.contextWindow
        return h('div', { key: mode.model, style: styles.card },
          cardHead(mode.label || mode.model, '模式 ' + mode.model + (mode.pinned ? ' · 锁定' : ''),
            h('div', { style: styles.actions },
              h('span', { style: styles.meta }, '上下文 ' + (kTokens(modeWindow) || '?') + ' K（链上最小值）'),
              h('label', { style: Object.assign({}, styles.meta, { marginLeft: 8 }) }, '输出 ',
                h('input', {
                  style: styles.num,
                  type: 'number',
                  value: kTokens(mode.maxTokens) || '',
                  onChange: (event) => update({ maxTokens: Number(event.target.value) * 1000 }),
                })),
              h('span', { style: styles.meta }, 'K'),
            )),
          h('label', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 13, color: 'var(--dsw-alias-label-secondary, #c6c9d0)' } },
            h('input', {
              type: 'checkbox',
              checked: mode.pinned === true,
              onChange: (event) => update({ pinned: event.target.checked }),
            }),
            '锁定首个平台（失败直接报错，不换平台）',
          ),
          providerRows,
          fallbackTargets.length > 0
            ? h('div', { style: styles.meta }, '兜底：' + fallbackTargets.join(' → '))
            : null,
        )
      })

      // ---- 授权/账号卡片 ----
      const qoderCard = h('div', { style: styles.card },
        cardHead('Qoder 授权', qoder && qoder.connected ? '已授权 · 模型 ' + ((qoder.models || []).length) : '未授权',
          qoder && qoder.connected
            ? h('div', { style: styles.actions },
              h('button', {
                style: Object.assign({}, styles.btn, (qoderCheckin && (qoderCheckin.claimed || qoderCheckin.status === 'already-claimed')) ? styles.btnOff : {}),
                disabled: Boolean(qoderCheckin && (qoderCheckin.claimed || qoderCheckin.status === 'already-claimed')),
                onClick: claimQoder,
              }, (qoderCheckin && (qoderCheckin.claimed || qoderCheckin.status === 'already-claimed')) ? '已签到' : '签到'),
              h('button', {
                style: styles.btn,
                onClick: () => {
                  getJson('/aihub/qoder/disconnect', { method: 'POST' })
                    .then(() => { setQoder({ connected: false }); setMessage('已断开') })
                    .catch((error) => setFailure('断开失败：' + String(error.message || error)))
                },
              }, '断开'),
            )
            : null),
        qoder && qoder.connected
          ? h('div', { style: styles.meta },
            (qoder.name || '') + (qoder.region ? ' · ' + qoder.region : ''),
            h('br'),
            ((qoder.credits && qoder.credits.rows) || []).map((row) => row.label + '：' + num(row.remaining) + ' / ' + num(row.total)).join('    ') || '无额度数据',
          )
          : h('div', null,
            h('div', { style: styles.meta }, qoder && qoder.error ? '上次失败：' + qoder.error : '粘贴 Qoder PAT 后点「连接」。模型与额度会立即读取。'),
            h('input', {
              style: styles.input,
              type: 'password',
              placeholder: 'Qoder Personal Access Token',
              value: pat,
              onChange: (event) => setPat(event.target.value),
            }),
            h('button', {
              style: Object.assign({}, styles.primary, { marginTop: 10 }),
              disabled: busy || pat.trim().length < 16,
              onClick: connectQoder,
            }, busy ? '授权中…' : '连接'),
          ),
      )

      const traeLines = ((trae && trae.accounts) || []).map((account) => {
        const credits = account.credits
        let text = '需重新登录'
        if (credits && credits.kind === 'credits') text = '可用 ' + num(credits.available) + ' / ' + num(credits.total)
        else if (credits && credits.kind === 'subscription') text = '订阅' + (credits.plan ? '：' + credits.plan : '')
        const label = { cn: 'Trae CN', solo: 'TRAE SOLO CN', 'solo-sg': 'TRAE SOLO' }[account.edition] || account.edition
        return h('div', { key: account.edition, style: styles.meta }, label + '：' + text)
      })
      const traeRoster = trae && trae.roster
      const traeCard = h('div', { style: styles.card },
        cardHead('Trae', (trae && trae.accounts && trae.accounts.length > 0) ? '本机登录' : '未找到登录',
          h('div', { style: styles.actions },
            h('button', {
              style: Object.assign({}, styles.btn, (traeCheckin && (traeCheckin.checkedIn || traeCheckin.didCheckedIn)) ? styles.btnOff : {}),
              disabled: Boolean(traeCheckin && (traeCheckin.checkedIn || traeCheckin.didCheckedIn)),
              onClick: claimTrae,
            }, (traeCheckin && (traeCheckin.checkedIn || traeCheckin.didCheckedIn)) ? '已签到' : '签到'),
            h('button', { style: styles.btn, onClick: () => { setTrae(null); load() } }, '刷新'),
          )),
        traeLines.length > 0 ? traeLines : h('div', { style: styles.meta }, '先在 Trae 客户端登录，AI Hub 读取本机凭据。'),
        h('div', { style: styles.meta }, '登录方式：打开对应的 Trae 客户端（Trae CN / TRAE SOLO CN / TRAE SOLO）登录后，回到这里点「刷新」。AI Hub 只读取本机凭据，不代管账号。'),
        traeRoster
          ? h('div', { style: styles.meta },
            '本地模型表：' + traeRoster.modelCount + ' 个 / ' + Object.keys(traeRoster.labels || {}).length + ' 类' +
            '（' + Object.entries(traeRoster.labels || {}).filter(([, n]) => n > 0).map(([k, n]) => k + ' ' + n).join('，') + '）',
          )
          : null,
      )

      const codeartsStale = Boolean(codearts && (codearts.accounts || []).some((account) => account.stale === true ||
        (account.error && /expired|APIG\.0602|401|403/i.test(String(account.error)))))
      const codeartsLines = ((codearts && codearts.accounts) || []).map((account) => {
        const credits = account.credits
        const text = credits
          ? (credits.planName || '') + ' 剩余 ' + num(credits.remain) + ' / ' + num(credits.total) + (credits.periodEnd ? '（到期 ' + credits.periodEnd + '）' : '')
          : (account.error || '额度读取失败')
        return h('div', { key: account.id, style: styles.meta }, (account.userName || 'CodeArts') + '：' + text)
      })
      const codeartsCard = h('div', { style: styles.card },
        cardHead('CodeArts', (codearts && codearts.accounts && codearts.accounts.length > 0) ? '本机账号 · 模型 ' + ((codearts.models || []).length) : '未登录',
          h('div', { style: styles.actions },
            h('button', {
              style: Object.assign({}, styles.btn, (codeartsCheckin && (codeartsCheckin.claimed || codeartsCheckin.status === 'already-claimed')) ? styles.btnOff : {}),
              disabled: Boolean(codeartsCheckin && (codeartsCheckin.claimed || codeartsCheckin.status === 'already-claimed')),
              onClick: claimCodearts,
            }, (codeartsCheckin && (codeartsCheckin.claimed || codeartsCheckin.status === 'already-claimed')) ? '已签到' : '签到'),
            h('button', {
              style: Object.assign({}, styles.btn, codeartsStale ? styles.btnWarn : {}),
              onClick: () => reloginCodearts(false),
            }, '自动续期'),
            h('button', {
              style: styles.btn,
              onClick: () => reloginCodearts(true),
            }, '华为云登录'),
            h('button', { style: styles.btn, onClick: () => { setCodearts(null); load() } }, '刷新'),
          )),
        codeartsStale
          ? h('div', { style: styles.warn }, 'CodeArts 登录已过期：「自动续期」会先复用本机已有的登录（客户端会话或刷新令牌）；两者都失效时，点「华为云登录」在浏览器里重新授权一次即可，授权完成后本卡片会自动刷新。')
          : null,
        loginUrl
          ? h('div', { style: styles.warn },
            '点此打开华为云授权页：',
            h('a', {
              href: loginUrl,
              target: '_blank',
              rel: 'noopener noreferrer',
              style: styles.loginLink,
            }, '华为云登录'),
            h('div', { style: styles.meta }, '登录成功后本卡片会自动刷新；此链接仅本次有效。'),
          )
          : null,
        codeartsLines.length > 0 ? codeartsLines : h('div', { style: styles.meta }, '先在 CodeArts 客户端完成华为云登录。'),
        h('div', { style: styles.meta }, '「自动续期」先复用本机 CodeArts Agent 客户端的登录会话，再用插件内的刷新令牌，整个过程不需要打开浏览器。「华为云登录」直接发起一次完整的华为云 OAuth 授权，适合两者都失效（或本机没有装客户端）的情况。'),
      )

      return h('div', { style: styles.wrap },
        h('h2', { style: styles.title }, 'AI Hub'),
        h('p', { style: styles.sub }, '平台按顺序消耗额度；额度用完、未登录或请求失败时自动切到下一个。'),
        failure ? h('p', { style: styles.err }, failure) : null,
        qoderCard,
        traeCard,
        codeartsCard,
        h('h2', { style: Object.assign({}, styles.title, { marginTop: 24, fontSize: 16 }) }, '模式配置'),
        h('p', { style: styles.meta }, '每个模式单独选择各平台使用的模型；上下文按上游声明自动计算，保存后立即生效。'),
        h('label', { style: { display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0 4px', fontSize: 13, color: 'var(--dsw-alias-label-secondary, #c6c9d0)' } },
          h('input', { type: 'checkbox', checked: useMax, onChange: (event) => setUseMax(event.target.checked) }),
          '使用上游声明的最大上下文窗口（勾选后按各模型最大窗口请求；不勾选按默认窗口）',
        ),
        modeCards,
        h('h2', { style: Object.assign({}, styles.title, { marginTop: 24, fontSize: 16 }) }, '使用顺序与模型'),
        platformCards,
        h('button', { style: styles.save, onClick: save }, '保存配置'),
        h('span', { style: styles.msg }, message),
        h('p', { style: styles.foot },
          'API 兜底：',
          (state.fallbacks || []).map((entry, i) => h('span', { key: String(i) }, i > 0 ? ' → ' : '', h('code', { style: styles.code }, String(entry)))),
        ),
      )
    }

    // ---- 侧栏额度卡 ----
    const SIDEBAR = {
      card: { padding: '10px 12px', borderTop: '1px solid var(--dsw-alias-border-l2, #3a3d45)' },
      head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
      title: { fontSize: 12, fontWeight: 600, color: 'var(--dsw-alias-label-primary, #e8e9ed)' },
      row: { marginTop: 10 },
      line: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 },
      name: { fontSize: 12, color: 'var(--dsw-alias-label-primary, #e8e9ed)' },
      value: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary, #9aa0aa)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
      track: { height: 4, borderRadius: 2, background: 'var(--dsw-alias-bg-layer-3, #2a2d34)', marginTop: 4, overflow: 'hidden' },
      fill: { height: '100%', borderRadius: 2, background: '#4a9eff' },
      actions: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
      link: { fontSize: 11, color: '#4a9eff', background: 'transparent', border: 0, padding: 0, cursor: 'pointer' },
      off: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary, #9aa0aa)', background: 'transparent', border: 0, padding: 0, cursor: 'default' },
      compact: { width: 32, height: 32, borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2, #3a3d45)', background: 'transparent', color: 'var(--dsw-alias-label-secondary, #c6c9d0)', fontSize: 11, cursor: 'pointer' },
    }

    function percentOf(remain, total) {
      if (!Number.isFinite(total) || total <= 0) return 0
      return Math.max(0, Math.min(100, Math.round((remain / total) * 1000) / 10))
    }

    async function sidebarSnapshot() {
      const [qoder, trae, codearts, qoderCheck, traeCheck, codeartsCheck] = await Promise.all([
        getJson('/aihub/qoder/state').catch(() => null),
        getJson('/aihub/trae/state').catch(() => null),
        getJson('/aihub/codearts/state').catch(() => null),
        getJson('/aihub/qoder/checkin').catch(() => null),
        getJson('/aihub/trae/checkin').catch(() => null),
        getJson('/aihub/codearts/checkin').catch(() => null),
      ])
      const rows = []
      if (qoder && qoder.connected) {
        const accounts = (qoder.credits && qoder.credits.rows) || []
        const remain = accounts.reduce((sum, row) => sum + (Number(row.remaining) || 0), 0)
        const total = accounts.reduce((sum, row) => sum + (Number(row.total) || 0), 0)
        rows.push({ id: 'qoder', label: 'Qoder', remain, total, claimed: Boolean(qoderCheck && (qoderCheck.claimed || qoderCheck.status === 'already-claimed')) })
      }
      const traeAccount = trae && (trae.accounts || []).find((account) => account.edition === 'cn')
      if (traeAccount && traeAccount.credits && traeAccount.credits.kind === 'credits') {
        rows.push({
          id: 'trae',
          label: 'Trae',
          remain: Number(traeAccount.credits.available) || 0,
          total: Number(traeAccount.credits.total) || 0,
          claimed: Boolean(traeCheck && (traeCheck.checkedIn || traeCheck.didCheckedIn)),
        })
      }
      const codeartsAccount = codearts && (codearts.accounts || [])[0]
      if (codeartsAccount && codeartsAccount.credits) {
        rows.push({
          id: 'codearts',
          label: 'CodeArts',
          remain: Number(codeartsAccount.credits.remain) || 0,
          total: Number(codeartsAccount.credits.total) || 0,
          claimed: Boolean(codeartsCheck && (codeartsCheck.claimed || codeartsCheck.status === 'already-claimed')),
        })
      }
      return { rows, at: new Date() }
    }

    function SidebarQuota(props) {
      const [snapshot, setSnapshot] = React.useState(null)
      const [busy, setBusy] = React.useState('')

      const load = React.useCallback(() => {
        sidebarSnapshot().then(setSnapshot).catch(() => setSnapshot({ rows: [] }))
      }, [])

      React.useEffect(() => {
        load()
        const timer = setInterval(load, 5 * 60 * 1000)
        return () => clearInterval(timer)
      }, [load])

      if (props.wide === false) {
        return h('button', { style: SIDEBAR.compact, title: 'AI Hub 额度' }, 'AH')
      }

      const rows = (snapshot && snapshot.rows) || []
      const claim = (id) => {
        setBusy(id)
        getJson('/aihub/' + id + '/checkin', { method: 'POST' })
          .then(() => load())
          .catch(() => {})
          .finally(() => setBusy(''))
      }

      return h('div', { style: SIDEBAR.card },
        h('div', { style: SIDEBAR.head },
          h('div', { style: SIDEBAR.title }, 'AI Hub 额度'),
          h('button', {
            style: SIDEBAR.link,
            onClick: () => { setSnapshot(null); load() },
          }, '刷新'),
        ),
        rows.length === 0
          ? h('div', { style: SIDEBAR.value }, snapshot === null ? '读取中…' : '暂无可用账号')
          : rows.map((row) => {
            const percent = percentOf(row.remain, row.total)
            return h('div', { key: row.id, style: SIDEBAR.row },
              h('div', { style: SIDEBAR.line },
                h('span', { style: SIDEBAR.name }, row.label),
                h('span', { style: SIDEBAR.value },
                  num(row.remain) + ' / ' + num(row.total) + '   ' + percent + '%'),
              ),
              h('div', { style: SIDEBAR.track },
                h('div', { style: Object.assign({}, SIDEBAR.fill, { width: percent + '%' }) }),
              ),
              h('div', { style: SIDEBAR.actions },
                h('span', { style: SIDEBAR.value }, '已用 ' + (100 - percent).toFixed(1) + '%'),
                row.claimed
                  ? h('span', { style: SIDEBAR.off }, '已签到')
                  : h('button', {
                    style: SIDEBAR.link,
                    disabled: busy === row.id,
                    onClick: () => claim(row.id),
                  }, busy === row.id ? '签到中…' : '签到'),
              ),
            )
          }),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'aihub',
          order: 25,
          label: 'AI Hub',
        }, HubPage))
        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'aihub-quota',
          order: 19,
        }, SidebarQuota))
      },
    }
  },
})