import { useState, useRef, useEffect, useCallback } from 'react'
import UploadZone from './components/UploadZone'
import Tab from './components/Tab'

// ── 定数 ──────────────────────────────────────────────────
const DIFF_COLOR = [220, 50, 50]
const DIFF_ALPHA = 0.55
const THRESH     = 20
const BLOCK      = 6
const MIN_BLOCK  = 0.08
const AI_COLORS  = ['#E24B4A','#185FA5','#1D9E75','#BA7517','#993556','#534AB7']

// ── ユーティリティ ────────────────────────────────────────
function fileToImg(file) {
  return new Promise(res => {
    const fr = new FileReader()
    fr.onload = e => {
      const url = e.target.result
      const b64 = url.split(',')[1]
      const el  = new Image()
      el.onload = () => res({ url, b64, el, w: el.naturalWidth, h: el.naturalHeight })
      el.src = url
    }
    fr.readAsDataURL(file)
  })
}

function compress(img, maxW = 1200, q = 0.82) {
  const s = Math.min(1, maxW / img.w)
  const c = document.createElement('canvas')
  c.width  = Math.round(img.w * s)
  c.height = Math.round(img.h * s)
  c.getContext('2d').drawImage(img.el, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', q).split(',')[1]
}

function buildOffscreen(img, W, H) {
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H)
  if (img) ctx.drawImage(img.el, 0, 0, W, H)
  return c
}

function computeDiff(offA, offB, W, H) {
  const getData = c => c.getContext('2d').getImageData(0, 0, W, H).data
  const a = getData(offA), b = getData(offB)
  const mask  = new Uint8ClampedArray(W * H * 4)
  const cols  = Math.ceil(W / BLOCK), rows = Math.ceil(H / BLOCK)

  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      let changed = 0, total = 0
      for (let dy = 0; dy < BLOCK; dy++) {
        for (let dx = 0; dx < BLOCK; dx++) {
          const px = bx*BLOCK+dx, py = by*BLOCK+dy
          if (px >= W || py >= H) continue
          const i = (py*W+px)*4
          const d = (Math.abs(a[i]-b[i]) + Math.abs(a[i+1]-b[i+1]) + Math.abs(a[i+2]-b[i+2])) / 3
          if (d > THRESH) changed++
          total++
        }
      }
      if (total > 0 && changed / total >= MIN_BLOCK) {
        for (let dy = 0; dy < BLOCK; dy++) {
          for (let dx = 0; dx < BLOCK; dx++) {
            const px = bx*BLOCK+dx, py = by*BLOCK+dy
            if (px >= W || py >= H) continue
            const i = (py*W+px)*4
            mask[i]=DIFF_COLOR[0]; mask[i+1]=DIFF_COLOR[1]
            mask[i+2]=DIFF_COLOR[2]; mask[i+3]=Math.round(DIFF_ALPHA*255)
          }
        }
      }
    }
  }
  const dc = document.createElement('canvas'); dc.width = W; dc.height = H
  dc.getContext('2d').putImageData(new ImageData(mask, W, H), 0, 0)
  return dc
}

// ── メインコンポーネント ──────────────────────────────────
export default function App() {
  const [imgA, setImgA]       = useState(null)
  const [imgB, setImgB]       = useState(null)
  const [mode, setMode]       = useState('slider')
  const [slider, setSlider]   = useState(50)
  const [aiRegions, setAiRegions] = useState([])
  const [busy, setBusy]       = useState(false)
  const [busyMsg, setBusyMsg] = useState('')
  const [error, setError]     = useState('')
  const [course, setCourse]   = useState('')
  const [canvasH, setCanvasH] = useState(400)
  const [cvW, setCvW]         = useState(640)

  const wrapRef  = useRef(null)
  const cvRef    = useRef(null)
  const offARef  = useRef(null)
  const offBRef  = useRef(null)
  const diffCvRef = useRef(null)
  const dragging = useRef(false)

  // キャンバス幅をラッパーに合わせる
  useEffect(() => {
    const upd = () => { if (wrapRef.current) setCvW(wrapRef.current.offsetWidth || 640) }
    upd()
    window.addEventListener('resize', upd)
    return () => window.removeEventListener('resize', upd)
  }, [])

  const unifiedH = useCallback(() => {
    if (!imgA) return 400
    const hA = Math.round(imgA.h * cvW / imgA.w)
    const hB = imgB ? Math.round(imgB.h * cvW / imgB.w) : 0
    return Math.max(hA, hB)
  }, [imgA, imgB, cvW])

  // オフスクリーンキャンバス再構築
  useEffect(() => {
    if (!imgA) return
    const W = cvW, H = unifiedH()
    setCanvasH(H)
    offARef.current  = buildOffscreen(imgA, W, H)
    offBRef.current  = buildOffscreen(imgB, W, H)
    if (imgA && imgB) {
      diffCvRef.current = computeDiff(offARef.current, offBRef.current, W, H)
    }
  }, [imgA, imgB, cvW])

  // メインキャンバス描画
  useEffect(() => {
    const cv = cvRef.current
    if (!cv || !imgA) return
    const W = cvW, H = canvasH
    cv.width = W; cv.height = H
    const ctx = cv.getContext('2d')
    ctx.clearRect(0, 0, W, H)

    if (mode === 'slider' && offARef.current && offBRef.current) {
      const sp = Math.round(W * slider / 100)
      ctx.drawImage(offARef.current, 0, 0)
      ctx.save(); ctx.beginPath(); ctx.rect(sp, 0, W-sp, H); ctx.clip()
      ctx.drawImage(offBRef.current, 0, 0)
      ctx.restore()
      // divider
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(sp, 0); ctx.lineTo(sp, H); ctx.stroke()
      ctx.fillStyle = '#fff'
      ctx.beginPath(); ctx.arc(sp, H/2, 16, 0, Math.PI*2); ctx.fill()
      ctx.strokeStyle = '#aaa'; ctx.lineWidth = 1
      ctx.beginPath(); ctx.arc(sp, H/2, 16, 0, Math.PI*2); ctx.stroke()
      ctx.fillStyle = '#555'; ctx.font = 'bold 13px sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText('◀▶', sp, H/2)
      // ラベル
      ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'left'
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(8, 8, 58, 22)
      ctx.fillStyle = '#fff'; ctx.fillText('既存LP', 14, 19)
      if (sp < W - 70) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(sp+8, 8, 68, 22)
        ctx.fillStyle = '#fff'; ctx.fillText('変更後LP', sp+14, 19)
      }
    } else if (mode === 'diff' && offARef.current) {
      ctx.drawImage(offARef.current, 0, 0)
      if (diffCvRef.current) ctx.drawImage(diffCvRef.current, 0, 0)
      aiRegions.forEach((r, i) => {
        const color = AI_COLORS[i % AI_COLORS.length]
        const rx = r.xPct/100*W, ry = r.yPct/100*H
        const rw = r.wPct/100*W, rh = r.hPct/100*H
        ctx.strokeStyle = color; ctx.lineWidth = 2.5
        ctx.strokeRect(rx, ry, rw, rh)
        const num = String(i+1), bw = num.length > 1 ? 26 : 20
        ctx.fillStyle = color
        ctx.beginPath(); ctx.roundRect(rx, Math.max(0,ry-22), bw, 22, 4); ctx.fill()
        ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText(num, rx+bw/2, Math.max(11,ry-11))
      })
    } else if (mode === 'side' && offARef.current && offBRef.current) {
      const hw = Math.floor(W/2) - 2
      ctx.fillStyle = '#e8e6e0'; ctx.fillRect(0,0,W,H)
      ctx.drawImage(offARef.current, 0, 0, hw, H, 0, 0, hw, H)
      ctx.drawImage(offBRef.current, 0, 0, hw, H, hw+4, 0, hw, H)
      ctx.fillStyle = 'rgba(44,44,42,0.2)'; ctx.fillRect(hw+1, 0, 2, H)
    }
  }, [mode, slider, imgA, imgB, aiRegions, cvW, canvasH])

  // スライダー操作
  const onSliderPointer = e => {
    if (!cvRef.current || mode !== 'slider') return
    const rect = cvRef.current.getBoundingClientRect()
    setSlider(Math.round(Math.max(0, Math.min(100, (e.clientX-rect.left)/rect.width*100))))
  }
  const onPointerDown = e => { dragging.current = true; onSliderPointer(e); cvRef.current.setPointerCapture(e.pointerId) }
  const onPointerMove = e => { if (dragging.current) onSliderPointer(e) }
  const onPointerUp   = () => { dragging.current = false }

  // AI解析
  const detectWithAI = async () => {
    if (!imgA || !imgB) return
    setBusy(true); setError(''); setBusyMsg('画像を圧縮中…')
    try {
      const b64A = compress(imgA), b64B = compress(imgB)
      setBusyMsg('AI解析中…')
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          messages: [{
            role: 'user',
            content: [
              { type:'image', source:{ type:'base64', media_type:'image/jpeg', data: b64A }},
              { type:'image', source:{ type:'base64', media_type:'image/jpeg', data: b64B }},
              { type:'text', text: `1枚目が既存LP、2枚目が変更後LPです。
内容の変化（テキスト・価格・ボタン・画像・追加・削除）をすべて検出してください。
レイアウトサイズの違いは無視し、コンテンツ変化のみを報告してください。

以下のJSON配列のみを返してください（コードブロック不要）:
[{"label":"変更内容（例：価格が87,700円→98,700円に変更）","yPct":20,"hPct":8,"xPct":5,"wPct":90}]
yPct/xPct/hPct/wPct は1枚目画像上の変更箇所の位置・サイズ（画像全体に対する%）。` }
            ]
          }]
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || 'APIエラー')
      const text = data.content.find(b => b.type==='text')?.text || ''
      const parsed = JSON.parse(text.replace(/```json|```/g,'').trim())
      setAiRegions(parsed.map((r,i) => ({ id:`ai-${i}`, ...r })))
      setMode('diff')
    } catch(e) { setError('AI解析エラー: ' + e.message) }
    finally { setBusy(false); setBusyMsg('') }
  }

  // PNG出力
  const exportPng = () => {
    const cv = cvRef.current; if (!cv) return
    const PAD = 16
    const c = document.createElement('canvas')
    c.width = cv.width + PAD*2; c.height = cv.height + 52
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#f4f3ef'; ctx.fillRect(0,0,c.width,c.height)
    ctx.fillStyle = '#2c2c2a'; ctx.font = 'bold 15px sans-serif'
    ctx.fillText(`LP差分レポート${course ? ' — '+course : ''}`, PAD, 28)
    ctx.fillStyle = '#888780'; ctx.font = '12px sans-serif'
    ctx.fillText(new Date().toLocaleDateString('ja-JP'), PAD, 46)
    ctx.drawImage(cv, PAD, 52)
    const a = document.createElement('a')
    a.href = c.toDataURL('image/png')
    a.download = `LP差分_${course||'無題'}_${new Date().toISOString().slice(0,10)}.png`
    a.click()
  }

  return (
    <div>
      {/* ヘッダー */}
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:16 }}>
        <div style={{ width:5, height:22, background:'#7F77DD', borderRadius:3 }} />
        <h1 style={{ margin:0, fontSize:18, fontWeight:500 }}>LP差分確認ツール</h1>
        <span style={{ fontSize:11, padding:'2px 8px', borderRadius:10, background:'#EEEDFE', color:'#534AB7', fontWeight:500 }}>v3</span>
      </div>

      {/* アップロードエリア */}
      {(!imgA || !imgB) && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:12 }}>
          {!imgA
            ? <UploadZone label="既存LP" onFile={async f => { setImgA(await fileToImg(f)); setAiRegions([]) }} color="#7F77DD" />
            : <div style={{ display:'flex', alignItems:'center', justifyContent:'center', border:'0.5px solid var(--color-border-tertiary)', borderRadius:'var(--border-radius-md)', fontSize:12, color:'var(--color-text-secondary)', padding:8 }}>✅ 既存LP 読み込み済み</div>
          }
          {!imgB
            ? <UploadZone label="変更後LP" onFile={async f => { setImgB(await fileToImg(f)); setAiRegions([]) }} color="#1D9E75" />
            : <div style={{ display:'flex', alignItems:'center', justifyContent:'center', border:'0.5px solid var(--color-border-tertiary)', borderRadius:'var(--border-radius-md)', fontSize:12, color:'var(--color-text-secondary)', padding:8 }}>✅ 変更後LP 読み込み済み</div>
          }
        </div>
      )}

      {/* コントロールバー */}
      {imgA && imgB && (
        <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center', marginBottom:10 }}>
          <label style={{ fontSize:12, cursor:'pointer', padding:'5px 10px', border:'0.5px solid var(--color-border-secondary)', borderRadius:'var(--border-radius-md)', color:'var(--color-text-secondary)', height:34, display:'flex', alignItems:'center' }}>
            <input type="file" accept="image/*" onChange={async e => { if(e.target.files[0]){setImgA(await fileToImg(e.target.files[0]));setAiRegions([])} }} style={{ display:'none' }} />既存LP 差替
          </label>
          <label style={{ fontSize:12, cursor:'pointer', padding:'5px 10px', border:'0.5px solid var(--color-border-secondary)', borderRadius:'var(--border-radius-md)', color:'var(--color-text-secondary)', height:34, display:'flex', alignItems:'center' }}>
            <input type="file" accept="image/*" onChange={async e => { if(e.target.files[0]){setImgB(await fileToImg(e.target.files[0]));setAiRegions([])} }} style={{ display:'none' }} />変更後LP 差替
          </label>
          <div style={{ width:'0.5px', background:'var(--color-border-secondary)', height:22 }} />
          <Tab active={mode==='slider'} onClick={() => setMode('slider')}>🔀 スライダー</Tab>
          <Tab active={mode==='diff'}   onClick={() => setMode('diff')}>🔴 差分ハイライト</Tab>
          <Tab active={mode==='side'}   onClick={() => setMode('side')}>⬜⬜ 並列</Tab>
          <div style={{ flex:1 }} />
          <button onClick={detectWithAI} disabled={busy}
            style={{ background:'var(--color-background-info)', color:'var(--color-text-info)', borderColor:'var(--color-border-info)', fontWeight:500 }}>
            {busy ? busyMsg : '✨ AI解析'}
          </button>
          <button onClick={exportPng}>⬇ PNG出力</button>
        </div>
      )}

      {/* エラー表示 */}
      {error && (
        <div style={{ fontSize:12, color:'var(--color-text-danger)', background:'var(--color-background-danger)', padding:'6px 12px', borderRadius:'var(--border-radius-md)', marginBottom:10 }}>
          {error}
        </div>
      )}

      {/* メインキャンバス */}
      <div ref={wrapRef} style={{ width:'100%', background:'#e8e6e0', borderRadius:'var(--border-radius-lg)', overflow:'hidden', minHeight: imgA ? canvasH : 0 }}>
        {imgA && (
          <canvas ref={cvRef}
            style={{ display:'block', width:'100%', cursor: mode==='slider' ? 'ew-resize' : 'default' }}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />
        )}
      </div>

      {/* AI変更点リスト */}
      {aiRegions.length > 0 && (
        <div style={{ marginTop:10, border:'0.5px solid var(--color-border-tertiary)', borderRadius:'var(--border-radius-lg)', overflow:'hidden' }}>
          <div style={{ padding:'8px 12px', background:'var(--color-background-secondary)', borderBottom:'0.5px solid var(--color-border-tertiary)', fontSize:13, fontWeight:500, display:'flex', alignItems:'center', gap:8 }}>
            AI検出 変更点一覧
            <span style={{ background:'#7F77DD', color:'#fff', fontSize:11, padding:'1px 7px', borderRadius:10 }}>{aiRegions.length}</span>
          </div>
          {aiRegions.map((r, i) => {
            const color = AI_COLORS[i % AI_COLORS.length]
            return (
              <div key={r.id} style={{ borderTop: i>0 ? '0.5px solid var(--color-border-tertiary)' : undefined, padding:'9px 12px', display:'flex', gap:8, alignItems:'flex-start' }}>
                <div style={{ width:20, height:20, borderRadius:4, background:color, color:'#fff', fontSize:11, fontWeight:500, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, marginTop:1 }}>{i+1}</div>
                <div style={{ flex:1, fontSize:12, lineHeight:1.6 }}>{r.label}</div>
                <button onClick={() => setAiRegions(p => p.filter(x => x.id !== r.id))}
                  style={{ fontSize:11, padding:'2px 7px', color:'var(--color-text-danger)', borderColor:'var(--color-border-danger)' }}>削除</button>
              </div>
            )
          })}
        </div>
      )}

      {/* 講座名 */}
      {imgA && imgB && (
        <div style={{ marginTop:10 }}>
          <input value={course} onChange={e => setCourse(e.target.value)} placeholder="講座名（PNG出力のファイル名に使用）" />
        </div>
      )}
    </div>
  )
}
