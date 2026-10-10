import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  Check,
  Copy,
  FileText,
  FolderOpen,
  Languages,
  LoaderCircle as Loader2,
  MessageSquarePlus,
  MessageSquareText,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  Pause,
  Play,
  RotateCcw,
  Settings,
  Sparkles,
  Trash,
  Undo2,
  Volume2,
  X
} from 'lucide-react'
import { blockConvention, errorText, speechText, t, warningText } from '@shared/i18n'
import { alignBlocks, parseDocument, reconcileNotes, formatTasks, type ParsedDoc } from '@shared/markdown'
import {
  type AppState,
  type Block,
  type DocUpdate,
  type LearnedWord,
  type Note,
  type NotesResult,
  type OpenedDocument,
  type Preferences,
  type ReadMode,
  type UiLang
} from '@shared/types'
import { wordKey } from '@shared/words'
import { BlockView, canSpeak, isLatin, paintNoteHighlights, quoteSelectionForRange } from './blocks'
import { UiProvider, useT, useUi } from './i18n'
import { useSpeech } from './useSpeech'
import logoMark from './assets/logo-mark.png'
import { editNoteDraftKey, listNoteDrafts, noteDraftKey, readNoteDrafts, writeNoteDrafts, type NoteDraftEntry, type NoteDrafts } from './note-drafts'
import { NotesPanel } from './NotesPanel'
import { NoteEditor, type NoteEditorTarget } from './NoteEditor'
import { noteReadMode, resolveNoteBlock } from './note-location'
import { ReadingOptions } from './ReadingOptions'
import { WordPopover } from './WordPopover'
import type { DictionaryResult, WordExplanation } from '@shared/word-help'
import { savedWordExplanation } from './word-cache'
import { SettingsModal } from './SettingsModal'
import { ReviewAssociation } from './ReviewAssociation'
import { normalizeQuoteText, type QuoteAnchor } from '@shared/quote-anchor'
import { TranslationNotice } from './TranslationNotice'
import type { AISettings } from '@shared/ai'
import { alignTranslatedBlocks } from '@shared/translation-alignment'
import { sentenceForRange } from './sentence-context'
import { selectionPosition, type SelectionRect } from './selection-position'
import { inspectPairing } from '@shared/pairing-diagnostics'
import { PairingStatus, PairingCheckDialog } from './PairingCheck'

type Selection = { block: Block; quote: string; lang: 'source' | 'zh'; x: number; y: number; anchor?: SelectionRect; sentence?: string; quoteAnchor?: QuoteAnchor; keyboard?: boolean }
type Popover = Selection & {
  mode: 'menu' | 'note' | 'gloss' | 'learn'; gloss?: string; detail?: string; loading?: boolean; busy?: boolean; sentence?: string
  lookupId?: string; sourcePath?: string; dictionary?: DictionaryResult; dictionaryLoading?: boolean
  explanation?: WordExplanation; details?: WordExplanation; error?: string; detailError?: string; wordOccurrence?: string
}
type Doc = OpenedDocument & { source: ParsedDoc; zh: ParsedDoc | null; notes: Note[] }

export function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [startupError, setStartupError] = useState(false)
  const [doc, setDoc] = useState<Doc | null>(null)
  const [status, setStatus] = useState('')
  const [speechNote, setSpeechNote] = useState('')
  const [notesOpen, setNotesOpen] = useState(false)
  const [wordsOpen, setWordsOpen] = useState(false)
  const [pop, setPop] = useState<Popover | null>(null)
  const [noteEditor, setNoteEditor] = useState<NoteEditorTarget | null>(null)
  const [pendingJump, setPendingJump] = useState<{ sourcePath: string; key: string; lang: 'source' | 'zh' } | null>(null)
  const pendingJumpRef = useRef(pendingJump)
  pendingJumpRef.current = pendingJump
  const documentRequest = useRef(0)
  const wordRequests = useRef(new Map<string, string>())
  const [lightbox, setLightbox] = useState('')
  const [toast, setToast] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [pairingOpen, setPairingOpen] = useState(false)
  const [aiSettings, setAISettings] = useState<AISettings | null>(null)
  const [translationRequested, setTranslationRequested] = useState<string | null>(null)
  const [dismissedTranslations, setDismissedTranslations] = useState<Set<string>>(() => new Set())
  const [flash, setFlash] = useState<Set<string>>(new Set())
  const [activeNote, setActiveNote] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [drafts, setDrafts] = useState<NoteDrafts>(() => {
    try { return readNoteDrafts(window.localStorage) } catch { return {} }
  })
  const [draftPersisted, setDraftPersisted] = useState(true)
  const draftPersistedRef = useRef(true)
  const draftsRef = useRef(drafts)
  const [noteSaving, setNoteSaving] = useState(false)
  const [restoringReview, setRestoringReview] = useState(false)
  const [noteError, setNoteError] = useState('')
  const savingNoteRef = useRef(false)
  const [compactWindow, setCompactWindow] = useState(() => window.matchMedia('(max-width: 1499px)').matches)
  const activeContextRef = useRef({ sourcePath: doc?.sourcePath, pop, noteEditor })
  activeContextRef.current = { sourcePath: doc?.sourcePath, pop, noteEditor }

  useEffect(() => {
    if (settingsOpen || pairingOpen || noteEditor || lightbox) {
      setPop((current) => current?.mode === 'learn' ? null : current)
    }
  }, [settingsOpen, pairingOpen, noteEditor, lightbox])

  useEffect(() => {
    const query = window.matchMedia('(max-width: 1499px)')
    const update = () => setCompactWindow(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  const scrollRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<{ key: string; top: number } | null>(null)
  const editingRef = useRef(false)
  const pendingRef = useRef<DocUpdate[]>([])
  const prevText = useRef<Map<string, string>>(new Map())
  const lastSavedPosition = useRef<{ path: string; key: string } | null>(null)
  const flashTimer = useRef<number>(0)

  const speechNoteCb = useCallback((message: string) => setSpeechNote(message), [])
  const speech = useSpeech(speechNoteCb)
  const stopSpeech = speech.stop

  const openDoc = useCallback(
    async (path: string, keepOnFailure = false) => {
      const request = ++documentRequest.current
      stopSpeech()
      setPop(null)
      setNoteEditor(null)
      setPairingOpen(false)
      setPendingJump(null)
      setActiveNote(null)
      try {
        const opened = await window.api.openDoc(path)
        if (request !== documentRequest.current) return null
        prevText.current = new Map()
        const next = hydrate(opened)
        setDoc(next)
        return next
      } catch {
        if (request === documentRequest.current && !keepOnFailure) setDoc(null)
        return null
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stopSpeech]
  )

  const applyState = useCallback(
    (next: AppState, openPath: string | null) => {
      setState(next)
      const target = openPath ?? (next.root ? next.library[0]?.path ?? null : null)
      if (target) void openDoc(target)
      else {
        ++documentRequest.current
        setDoc(null)
        setPop(null)
        setNoteEditor(null)
        setPendingJump(null)
        setActiveNote(null)
      }
    },
    [openDoc]
  )

  useEffect(() => {
    void window.api.getState().then((next) => {
      setState(next)
      const target = next.openPath ?? (next.root ? next.library[0]?.path ?? null : null)
      if (target) void openDoc(target)
    }).catch(() => setStartupError(true))
  }, [openDoc])

  const updateRef = useRef<(update: DocUpdate) => void>(() => undefined)
  updateRef.current = (update: DocUpdate) => {
    if (editingRef.current) pendingRef.current.push(update)
    else applyUpdate(update)
  }

  useEffect(() => {
    const offState = window.api.onState(({ state: next, openPath }) => applyState(next, openPath))
    const offLibrary = window.api.onLibrary((library) => setState((s) => (s ? { ...s, library } : s)))
    const offStatus = window.api.onDocStatus(() => setStatus('updating'))
    const offDoc = window.api.onDoc((update) => updateRef.current(update))
    return () => {
      offState()
      offLibrary()
      offStatus()
      offDoc()
    }
  }, [applyState])

  const applyAISettings = useCallback((next: AISettings) => {
    const profile = next.profiles[next.provider]
    setAISettings(next)
    setState((current) => current ? { ...current, hasKey: profile.hasKey, prefs: { ...current.prefs, model: profile.model } } : current)
    // A response issued using the previous service must not replace a new lookup.
    wordRequests.current.clear()
    setPop(null)
  }, [])

  useEffect(() => {
    let alive = true
    let version = 0
    const off = window.api.onAISettings((next) => { version++; if (alive) applyAISettings(next) })
    void window.api.getAISettings().then((next) => { if (alive && version === 0) applyAISettings(next) }).catch(() => {})
    return () => { alive = false; off() }
  }, [applyAISettings])

  const prefs = state?.prefs
  const ui: UiLang = prefs?.ui ?? 'en'
  const mode: ReadMode = doc?.zh ? prefs?.mode ?? 'source' : 'source'
  const reviewing = notesOpen || wordsOpen
  const sidebarVisible = !!prefs?.sidebar && !(reviewing && compactWindow)

  useEffect(() => {
    document.documentElement.lang = ui === 'zh' ? 'zh-CN' : 'en'
  }, [ui])
  const hasZh = !!doc?.zh
  const showZh = mode !== 'source' && hasZh
  const knownWords = useMemo(() => new Set((doc?.words ?? []).map((item) => item.key)), [doc?.words])
  const aligned = useMemo(
    () => (doc?.zh && mode === 'bilingual' ? alignTranslatedBlocks(doc.source.blocks, doc.zh.blocks, doc.sourceText, doc.zhText ?? '', doc.translationAlignment) : null),
    [doc, mode]
  )
  const pairing = useMemo(() => doc ? inspectPairing({
    sourceText: doc.sourceText, zhText: doc.zhText,
    source: doc.source, zh: doc.zh,
    alignment: doc.translationAlignment,
    alignmentState: doc.translationAlignmentState
  }) : null, [doc?.sourceText, doc?.zhText, doc?.source, doc?.zh, doc?.translationAlignment, doc?.translationAlignmentState])

  useLayoutEffect(() => {
    const saved = restoreRef.current
    restoreRef.current = null
    const root = scrollRef.current
    if (!saved || !root) return
    const el = root.querySelector<HTMLElement>(`[data-key="${cssEscape(saved.key)}"]`)
    if (el) root.scrollTop += el.getBoundingClientRect().top - root.getBoundingClientRect().top - saved.top
  }, [doc?.sourceText, doc?.zhText, doc?.assetVersion, mode])

  useLayoutEffect(
    () => paintNoteHighlights(scrollRef.current, doc?.notes ?? [], activeNote),
    [doc?.notes, doc?.sourceText, doc?.zhText, mode, activeNote, state?.prefs.fontSize]
  )

  // Restore last read position when a document first opens.
  const openedKey = doc?.sourcePath
  useEffect(() => {
    const root = scrollRef.current
    if (!doc || !root || !state || pendingJumpRef.current) return
    const key = state.scroll[doc.sourcePath]
    requestAnimationFrame(() => {
      if (pendingJumpRef.current) return
      if (!key) {
        root.scrollTop = 0
        return
      }
      const el = root.querySelector<HTMLElement>(`[data-key="${cssEscape(key)}"]`)
      if (el) root.scrollTop += el.getBoundingClientRect().top - root.getBoundingClientRect().top - 12
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openedKey])

  useEffect(() => {
    if (!pop && !noteEditor) {
      editingRef.current = false
      if (pendingRef.current.length) drainPending()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pop, noteEditor])

  useLayoutEffect(() => {
    if (!pendingJump || !doc || doc.sourcePath !== pendingJump.sourcePath) return
    if (mode !== 'bilingual' && mode !== pendingJump.lang) return
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-key="${cssEscape(pendingJump.key)}"][data-lang="${pendingJump.lang}"]`)
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'instant' })
      if (!noteEditor) {
        el.tabIndex = -1
        el.focus({ preventScroll: true })
      }
      setFlash(new Set([`${pendingJump.lang}:${pendingJump.key}`]))
      window.clearTimeout(flashTimer.current)
      flashTimer.current = window.setTimeout(() => setFlash(new Set()), 1900)
    } else flashToast(t(ui, 'noteLocateFailed'))
    setPendingJump(null)
  }, [pendingJump, mode, noteEditor, doc?.sourcePath, doc?.sourceText, doc?.zhText])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      // The native dialog handles Escape and keeps reader shortcuts inactive.
      if (pairingOpen) return
      if (event.key === 'Escape') {
        if (settingsOpen) return
        else if (noteEditor) setNoteEditor(null)
        else if (pop) setPop(null)
        else if (lightbox) setLightbox('')
        else if (speech.playing) stopSpeech()
        return
      }
      if (noteEditor || settingsOpen) return
      if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.isContentEditable) {
        return
      }
      if (event.altKey && event.key === 'Enter') {
        event.preventDefault()
        openKeyboardSelection()
      } else if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault()
        setSettingsOpen(true)
      } else if (!event.metaKey && !event.ctrlKey && (event.key === '1' || event.key === '2' || event.key === '3')) {
        requestReadMode(event.key === '1' ? 'source' : event.key === '2' ? 'zh' : 'bilingual')
      } else if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'b') {
        setNotesOpen((v) => !v)
        setWordsOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pop, noteEditor, lightbox, speech.playing, hasZh, stopSpeech, settingsOpen, pairingOpen, doc, state?.hasKey, ui])

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (!draftPersistedRef.current && listNoteDrafts(draftsRef.current).length > 0) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [])

  if (!state) {
    const zh = /^zh\b/i.test(navigator.language)
    return (
      <div className="welcome">
        <div className="card" role={startupError ? 'alert' : 'status'}>
          <h1>MD Duck</h1>
          {startupError ? <>
            <p>{zh ? '暂时无法打开阅读界面，请重新启动。文章和已保存的批注不受影响。' : 'The reader could not start. Restart the app; your articles and saved notes are preserved.'}</p>
            <button className="btn primary" onClick={() => void window.api.restartStartup()}>{zh ? '重新启动' : 'Restart'}</button>
          </> : <p className="startup-loading"><Loader2 className="spin" size={18} />{zh ? '正在打开阅读内容…' : 'Opening your reading…'}</p>}
        </div>
      </div>
    )
  }

  const settingsDialog = settingsOpen && <SettingsModal
    state={state} onPrefs={savePrefs} aiSettings={aiSettings} onAISettings={applyAISettings}
    onClose={() => setSettingsOpen(false)} onCopyConvention={() => {
      void window.api.copyText(blockConvention(ui)); flashToast(t(ui, 'copiedConvention'))
    }}
  />

  if (!state.root && listNoteDrafts(drafts).length === 0) {
    return (
      <UiProvider value={ui}>
        <Welcome dragOver={dragOver} setDragOver={setDragOver} onDrop={onDropPath} noRoot onPrefs={savePrefs} onSettings={() => setSettingsOpen(true)} />
        {settingsDialog}
      </UiProvider>
    )
  }

  const notes = doc?.notes ?? []
  const openNotes = notes.filter((note) => note.status !== 'resolved')
  const activeDraftKey = doc && pop ? noteDraftKey(doc.sourcePath, pop.lang, pop.block) : ''
  const activeDraft = drafts[activeDraftKey]
  const draftEntries = listNoteDrafts(drafts)
  const panelDrafts = draftEntries.map((entry) => {
    const isCurrent = entry.sourcePath === doc?.sourcePath
    const saved = isCurrent && entry.kind === 'note' ? notes.find((note) => note.id === entry.target) : undefined
    const target = saved ?? draftLocation(entry)
    const unavailable = isCurrent && (entry.kind === 'note' && !saved || !resolveNoteBlock(target, doc!.source.blocks, doc!.zh?.blocks ?? null).block)
    return {
      ...entry, isCurrent, isEdit: entry.kind === 'note', unavailable,
      documentLabel: state.library.find((item) => item.path === entry.sourcePath)?.title ?? entry.sourcePath.split(/[/\\]/).slice(-2).join('/')
    }
  }).sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent))
  const editorComment = noteEditor ? drafts[noteEditor.draftKey]?.comment ?? noteEditor.originalComment : ''

  return (
    <UiProvider value={ui}>
    <div
      className={`app${reviewing ? ' reviewing' : ''}`}
      style={{ ['--fs' as string]: `${state.prefs.fontSize}px` }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={(e) => {
        if (e.relatedTarget === null) setDragOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        const file = e.dataTransfer.files[0]
        if (file) void onDropPath(window.api.pathForFile(file))
      }}
    >
      <Sidebar
        state={state}
        visible={sidebarVisible}
        doc={doc}
        onOpen={(path) => void openDoc(path)}
        onPrefs={savePrefs}
        onJump={jumpToHeading}
        onPickRoot={() => void window.api.pickRoot()}
        onFileMenu={(path, position) => void showFileMenu(path, position)}
      />

      <div className="main">
        <Topbar
          doc={doc}
          prefs={{ ...prefs!, mode }}
          sidebarVisible={sidebarVisible}
          onToggleSidebar={() => {
            if (!sidebarVisible && reviewing && compactWindow) {
              setNotesOpen(false)
              setWordsOpen(false)
              if (!prefs!.sidebar) void savePrefs({ sidebar: true })
            } else void savePrefs({ sidebar: !sidebarVisible })
          }}
          onSettings={() => setSettingsOpen(true)}
          hasZh={hasZh}
          openCount={openNotes.length}
          notesOpen={notesOpen}
          wordCount={doc?.words.length ?? 0}
          wordsOpen={wordsOpen}
          status={status}
          speechNote={speechNote}
          onPrefs={savePrefs}
          onToggleNotes={() => {
            setNotesOpen((v) => !v)
            setWordsOpen(false)
          }}
          onReadMode={requestReadMode}
          onToggleWords={() => {
            setWordsOpen((v) => !v)
            setNotesOpen(false)
          }}
        />

        <div className="scroll" ref={scrollRef} onScroll={onScroll}>
          {doc && !doc.missing && (!dismissedTranslations.has(doc.sourcePath) || translationRequested === doc.sourcePath) && (
            <TranslationNotice
              key={doc.sourcePath}
              sourcePath={doc.sourcePath}
              documentVersion={doc.assetVersion}
              hasTranslation={hasZh}
              hasKey={state.hasKey}
              requested={translationRequested === doc.sourcePath}
              ui={ui}
              onSettings={() => setSettingsOpen(true)}
              onReady={() => {
                const path = doc.sourcePath
                void openDoc(path).then((opened) => {
                  if (opened && activeContextRef.current.sourcePath === path) {
                    void savePrefs({ mode: 'bilingual' })
                    setTranslationRequested(null)
                  }
                })
              }}
              onDismiss={() => {
                setDismissedTranslations((current) => new Set(current).add(doc.sourcePath))
                setTranslationRequested(null)
              }}
            />
          )}
          {doc ? (
            <Reader
              doc={doc}
              mode={mode}
              showZh={showZh}
              aligned={aligned}
              pairing={pairing}
              onCheckPairing={() => { setPop(null); setPairingOpen(true) }}
              flash={flash}
              notes={notes}
              speaking={speech.playing}
              onImage={setLightbox}
              restoring={restoringReview}
              onRestore={() => void restoreReview()}
              onRevealLegacy={() => void window.api.revealLegacyReview(doc.sourcePath).catch(reportReviewError)}
              onCloseDocument={closeDocument}
              onAssociated={setNotes}
              onSpeak={speakBlock}
              onSelect={(block, quote, lang, rect, sentence, quoteAnchor) => {
                editingRef.current = true
                setPop({
                  block,
                  quote,
                  lang,
                  sentence,
                  quoteAnchor,
                  mode: 'menu',
                  anchor: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
                  x: rect.left + rect.width / 2,
                  y: rect.bottom + 8
                })
              }}
              onAnnotate={(block, lang) => openPopover(block, block.text.trim(), lang, 'note')}
              onTranslate={(block, lang) => translateBlock(block, lang)}
              onWord={learnWord}
              knownWords={knownWords}
              activeWord={pop?.mode === 'learn' && pop.sourcePath === doc.sourcePath && !settingsOpen && !noteEditor && !lightbox ? pop.wordOccurrence ?? null : null}
            />
          ) : !state.root ? (
            <Welcome dragOver={dragOver} setDragOver={setDragOver} onDrop={onDropPath} noRoot onPrefs={savePrefs} onSettings={() => setSettingsOpen(true)} />
          ) : (
            <div className="empty-reader">
              <FileText size={28} />
              <p>{state.library.length ? t(ui, 'pickArticle') : t(ui, 'noMarkdownInFolder')}</p>
              <span>{t(ui, 'autoUpdateHint')}</span>
            </div>
          )}
        </div>

        {speech.playing && (
          <div className="speechbar">
            <button className="play" onClick={() => speech.toggle()} title={speech.playing.paused ? t(ui, 'resume') : t(ui, 'pause')} aria-label={speech.playing.paused ? t(ui, 'resume') : t(ui, 'pause')}>
              {speech.playing.paused ? <Play size={16} /> : speech.playing.preparing ? <Loader2 className="spin" size={16} /> : <Pause size={16} />}
            </button>
            <span className="label">{speech.playing.paused ? t(ui, 'paused') : speechText(ui, speechNote) || t(ui, 'reading')}</span>
            {doc?.source.blocks.some((block) => block.key === speech.playing?.key) && <button onClick={replay} title={t(ui, 'replay')} aria-label={t(ui, 'replay')}>
              <RotateCcw size={15} />
            </button>}
            <button onClick={() => speech.stop()} title={t(ui, 'stop')} aria-label={t(ui, 'stop')}>
              <X size={16} />
            </button>
          </div>
        )}
      </div>

      {wordsOpen && doc && (
        <WordsPanel
          words={doc.words}
          onListen={(item) => {
            const list = item ? [item] : doc.words
            const script = list.map((entry) => `${entry.word}. ${entry.sentence}`).join(' ')
            if (script.trim()) {
              speech.speak('words', script)
            }
          }}
          onDelete={(id) => void window.api.deleteWord(doc.sourcePath, id).then((words) => setWords(words, doc.sourcePath)).catch(reportReviewError)}
          onClose={() => setWordsOpen(false)}
        />
      )}

      {notesOpen && (doc || panelDrafts.length > 0) && (
        <NotesPanel
          notes={notes}
          activeId={activeNote}
          onJump={jumpToNote}
          onEdit={editNote}
          drafts={panelDrafts}
          onResumeDraft={(key) => void resumeDraft(key)}
          onCopy={(list) => void copyTasks(list)}
          onStatus={(id, s) => { if (doc) void window.api.setNoteStatus(doc.sourcePath, id, s).then((result) => setNotes(result, doc.sourcePath)).catch(reportReviewError) }}
          onDelete={(id) => { if (doc) void window.api.deleteNote(doc.sourcePath, id).then((result) => setNotes(result, doc.sourcePath)).catch(reportReviewError) }}
          onClose={() => setNotesOpen(false)}
        />
      )}

      {pairingOpen && pairing && doc && (
        <PairingCheckDialog
          report={pairing} ui={ui} sourcePath={doc.sourcePath} zhPath={doc.zhPath}
          onClose={() => setPairingOpen(false)}
          onLocate={(location) => {
            setPairingOpen(false)
            if (location.blockKey) revealBlock(doc.sourcePath, location.blockKey, location.side)
          }}
        />
      )}

      {noteEditor && (
        <NoteEditor
          key={noteEditor.draftKey}
          target={noteEditor}
          comment={editorComment}
          hasDraft={!!drafts[noteEditor.draftKey]}
          persisted={draftPersisted}
          saving={noteSaving}
          error={noteError}
          onComment={updateEditorDraft}
          onSave={() => void saveEditorNote()}
          onClose={() => setNoteEditor(null)}
          onRestore={doc?.sourcePath === noteEditor.sourcePath && doc.notesMissing ? () => void restoreReview() : undefined}
          restoring={restoringReview}
          onDiscard={() => { discardDraft(noteEditor.draftKey); setNoteEditor(null) }}
          onCopy={() => void window.api.copyText(`${noteEditor.quote}\n\n${editorComment}`)}
        />
      )}

      {pop?.mode === 'learn' && (
        <WordPopover
          key={pop.lookupId}
          x={pop.x}
          y={pop.y}
          word={pop.quote}
          sentence={pop.sentence ?? ''}
          dictionary={pop.dictionary}
          dictionaryLoading={!!pop.dictionaryLoading}
          explanation={pop.explanation}
          loading={!!pop.loading}
          error={pop.error}
          details={pop.details}
          detailLoading={!!pop.busy}
          detailError={pop.detailError}
          hasKey={state.hasKey}
          voiceAccent={state.prefs.voice.startsWith('b') ? 'uk' : 'us'}
          audioState={wordAudioState(pop)}
          onStopAudio={speech.stop}
          autoFocus={!!pop.keyboard}
          onSpeak={() => speech.speak(`sel:${pop.quote}`, pop.quote)}
          onSlowSpeak={() => speech.speak(`word-slow:${pop.quote}`, pop.quote, 0.75)}
          onReadSentence={() => {
            if (pop.sentence) speech.speak(`sent:${pop.lookupId}`, pop.sentence)
          }}
          onDetail={() => void fetchWordExplanation(pop, true)}
          onRetry={() => void fetchWordExplanation(pop, false)}
          onRetryDictionary={() => void fetchWordDictionary(pop)}
          onClose={() => setPop(null)}
          onSettings={() => { setPop(null); setSettingsOpen(true) }}
        />
      )}

      {pop && pop.mode !== 'learn' && (
        <SelectionPopover
          pop={pop}
          comment={activeDraft?.comment ?? ''}
          onComment={updateDraft}
          draftPersisted={draftPersisted}
          noteSaving={noteSaving}
          noteError={noteError}
          onRestore={doc?.notesMissing ? () => void restoreReview() : undefined}
          restoring={restoringReview}
          onDiscardDraft={() => {
            updateDraft('')
            setPop(null)
          }}
          hasKey={state.hasKey}
          onTranslate={() => runGloss(false)}
          onDetail={() => runGloss(true)}
          onAnnotate={() => beginNote(pop)}
          onSpeak={() => {
            if (isLatin(pop.quote)) speech.speak(`sel:${pop.quote}`, pop.quote)
            setPop(null)
          }}
          onSaveNote={saveNote}
          onClose={() => setPop(null)}
          onSettings={() => {
            setPop(null)
            setSettingsOpen(true)
          }}
        />
      )}

      {settingsDialog}

      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox('')}>
          <img src={lightbox} alt="" />
        </div>
      )}

      {dragOver && (
        <div className="drop-veil">
          <div className="box">{t(ui, 'dropReleaseFile')}</div>
        </div>
      )}

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <Check size={15} />
          {toast}
        </div>
      )}
    </div>
    </UiProvider>
  )

  function hydrate(opened: OpenedDocument): Doc {
    const source = parseDocument(opened.sourceText, fileTitle(opened.sourcePath))
    const zh = opened.zhText?.trim() ? parseDocument(opened.zhText, 'Chinese') : null
    const notes = reconcileNotes(opened.notes, source.blocks, zh?.blocks ?? null)
    for (const block of source.blocks) prevText.current.set(`source:${block.key}`, block.text)
    for (const block of zh?.blocks ?? []) prevText.current.set(`zh:${block.key}`, block.text)
    return { ...opened, words: opened.words ?? [], source, zh, notes }
  }

  function captureAnchor() {
    const root = scrollRef.current
    if (!root) return
    const top = root.getBoundingClientRect().top
    for (const el of root.querySelectorAll<HTMLElement>('[data-key]')) {
      if (el.getBoundingClientRect().bottom > top + 4) {
        restoreRef.current = { key: el.dataset.key ?? '', top: el.getBoundingClientRect().top - top }
        return
      }
    }
  }

  function applyUpdate(update: DocUpdate) {
    setStatus('')
    setDoc((current) => {
      if (!current || current.sourcePath !== update.sourcePath) return current
      captureAnchor()
      const next: Doc = { ...current, assetVersion: update.assetVersion,
        translationAlignment: update.translationAlignment === undefined ? current.translationAlignment : update.translationAlignment,
        translationAlignmentState: update.translationAlignmentState === undefined ? current.translationAlignmentState : update.translationAlignmentState }
      if (update.side === 'source') {
        next.missing = update.missing
        if (update.text != null) next.sourceText = update.text
      }
      if (update.zhPath !== undefined) next.zhPath = update.zhPath
      if (update.zhDir !== undefined) next.zhDir = update.zhDir
      if (update.side === 'zh') next.zhText = update.missing ? null : update.text ?? current.zhText
      const source = parseDocument(next.sourceText, fileTitle(next.sourcePath))
      const zh = next.zhText?.trim() ? parseDocument(next.zhText, 'Chinese') : null
      const changed = new Set<string>()
      const track = (lang: 'source' | 'zh', blocks: Block[]) => {
        for (const block of blocks) {
          const key = `${lang}:${block.key}`
          const before = prevText.current.get(key)
          if (before !== undefined && before !== block.text) changed.add(key)
          prevText.current.set(key, block.text)
        }
      }
      track('source', source.blocks)
      track('zh', zh?.blocks ?? [])
      next.source = source
      next.zh = zh
      next.notes = reconcileNotes(current.notes, source.blocks, zh?.blocks ?? null)
      if (changed.size) {
        setFlash(changed)
        window.clearTimeout(flashTimer.current)
        flashTimer.current = window.setTimeout(() => setFlash(new Set()), 1900)
      }
      return next
    })
  }

  function drainPending() {
    const updates = pendingRef.current
    pendingRef.current = []
    updates.forEach(applyUpdate)
  }

  function onScroll() {
    const root = scrollRef.current
    if (!root || !doc) return
    const top = root.getBoundingClientRect().top
    for (const element of root.querySelectorAll<HTMLElement>('[data-key]')) {
      if (element.getBoundingClientRect().bottom <= top + 4) continue
      const key = element.dataset.key ?? ''
      if (lastSavedPosition.current?.path === doc.sourcePath && lastSavedPosition.current.key === key) return
      lastSavedPosition.current = { path: doc.sourcePath, key }
      void window.api.saveScroll(doc.sourcePath, key).catch(() => {})
      setState((current) => current ? { ...current, scroll: { ...current.scroll, [doc.sourcePath]: key } } : current)
      break
    }
  }

  async function savePrefs(patch: Partial<Preferences>) {
    const next = await window.api.setPrefs(patch)
    setState((s) => (s ? { ...s, prefs: next } : s))
  }

  function requestReadMode(next: ReadMode) {
    if (next !== 'source' && !hasZh) {
      if (doc) {
        setTranslationRequested(doc.sourcePath)
        setDismissedTranslations((current) => {
          const result = new Set(current)
          result.delete(doc.sourcePath)
          return result
        })
        scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
      }
      return
    }
    void savePrefs({ mode: next })
  }

  function setNotes(result: NotesResult, sourcePath?: string) {
    setDoc((current) => {
      if (!current || sourcePath && current.sourcePath !== sourcePath) return current
      return { ...current, notesMissing: result.notesMissing, reviewIssue: result.reviewIssue, legacyUnassigned: result.legacyUnassigned, words: result.words ?? current.words, notes: reconcileNotes(result.notes, current.source.blocks, current.zh?.blocks ?? null) }
    })
  }

  function reviewError(error: unknown, fallback: 'noteSaveFailed' | 'wordSaveFailed' = 'noteSaveFailed') {
    const message = error instanceof Error ? error.message : ''
    return message.includes('REVIEW_') ? errorText(ui, message, fallback) : t(ui, fallback)
  }

  function reportReviewError(error: unknown) {
    flashToast(reviewError(error))
    if (doc && error instanceof Error && error.message.includes('REVIEW_')) void refreshReviewState(doc.sourcePath)
  }

  async function showFileMenu(path: string, position: { x: number; y: number }) {
    try {
      const result = await window.api.showFileMenu(path, position)
      if (result?.action === 'copy-path') {
        flashToast(t(ui, result.target === 'translation' ? 'translationPathCopied' : 'filePathCopied'))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      flashToast(/ERR_(?:NOT_FOUND|ONLY_MD|NOT_IN_FOLDER|OPEN_FILE)\b/.test(message)
        ? errorText(ui, message, 'fileActionFailed') : t(ui, 'fileActionFailed'))
    }
  }

  async function refreshReviewState(path: string) {
    if (activeContextRef.current.sourcePath !== path) return
    try { setNotes(await window.api.getNotes(path), path) } catch { /* Keep the original save error visible. */ }
  }

  function closeDocument() {
    if (!doc) return
    const path = doc.sourcePath
    stopSpeech()
    setPop(null); setNoteEditor(null); setPendingJump(null); setActiveNote(null)
    ++documentRequest.current
    setDoc(null)
    void window.api.closeDoc(path).catch(() => {})
  }

  function wordAudioState(target: Popover) {
    const playing = speech.playing
    if (!playing) return undefined
    const action = playing.key === `sel:${target.quote}` ? 'word'
      : playing.key === `word-slow:${target.quote}` ? 'slow'
      : playing.key === `sent:${target.lookupId}` ? 'sentence' : undefined
    return action ? { action: action as 'word' | 'slow' | 'sentence', paused: playing.paused, preparing: playing.preparing, message: speechText(ui, speechNote) } : undefined
  }

  function openKeyboardSelection() {
    if (!doc) return
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || !selection.rangeCount) return
    const host = nodeEl(selection.anchorNode)?.closest<HTMLElement>('[data-key][data-lang]')
    if (!host || host !== nodeEl(selection.focusNode)?.closest('[data-key][data-lang]') || !scrollRef.current?.contains(host)) return
    const lang = host.dataset.lang === 'zh' ? 'zh' : 'source'
    const block = (lang === 'zh' ? doc.zh?.blocks : doc.source.blocks)?.find((item) => item.key === host.dataset.key)
    if (!block) return
    const range = selection.getRangeAt(0)
    const target = quoteSelectionForRange(block, host, range)
    const quote = target?.quote ?? selection.toString().trim()
    if (!quote) return
    const rect = range.getBoundingClientRect()
    if (lang === 'source' && /^[A-Za-z]+(?:['’-][A-Za-z]+)*$/.test(quote)) {
      openWordCard(block, quote, rect.left + rect.width / 2, rect.bottom + 8, false, sentenceForRange(range), undefined, true)
    } else {
      editingRef.current = true
      setPop({ block, quote, lang, quoteAnchor: target?.quoteAnchor, mode: 'menu', keyboard: true,
        anchor: rect, x: rect.left + rect.width / 2, y: rect.bottom + 8, sentence: sentenceForRange(range) })
    }
  }

  async function restoreReview() {
    if (!doc || restoringReview) return
    const path = doc.sourcePath
    setRestoringReview(true)
    try {
      const result = await window.api.restoreNotes(path)
      setNotes(result, path)
      if (activeContextRef.current.sourcePath === path) {
        setNoteError('')
        flashToast(t(ui, 'reviewRestored'))
      }
    } catch (error) { if (activeContextRef.current.sourcePath === path) reportReviewError(error) }
    finally { setRestoringReview(false) }
  }

  function speakBlock(block: Block, lang: 'source' | 'zh') {
    if (lang !== 'source' || !canSpeak(block)) return
    speech.speak(block.key, block.text)
  }

  function replay() {
    if (!speech.playing) return
    const block = doc?.source.blocks.find((b) => b.key === speech.playing?.key)
    if (block) speech.replay(block.text)
  }

  function openPopover(block: Block, quote: string, lang: 'source' | 'zh', mode: Popover['mode']) {
    if (!quote.trim()) return
    const rect = currentSelectionRect()
    editingRef.current = true
    const next: Popover = {
      block,
      quote: quote.trim(),
      quoteAnchor: normalizeQuoteText(quote) === normalizeQuoteText(block.text) && normalizeQuoteText(block.text)
        ? { start: 0, end: normalizeQuoteText(block.text).length, prefix: '', suffix: '' } : undefined,
      lang,
      mode,
      anchor: rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } : undefined,
      x: rect ? rect.left + rect.width / 2 : window.innerWidth / 2,
      y: rect ? rect.bottom + 8 : 120
    }
    if (mode === 'note') beginNote(next)
    else setPop(next)
  }

  function beginNote(target: Popover) {
    setNoteEditor(null)
    editingRef.current = true
    const draft = doc ? drafts[noteDraftKey(doc.sourcePath, target.lang, target.block)] : undefined
    setNoteError('')
    setPop({ ...target, mode: 'note', quote: draft?.quote ?? target.quote, quoteAnchor: draft ? draft.quoteAnchor : target.quoteAnchor })
  }

  function persistDrafts(next: NoteDrafts) {
    draftsRef.current = next
    setDrafts(next)
    let persisted = false
    try { persisted = writeNoteDrafts(window.localStorage, next) } catch { /* Exit guard keeps unsaved drafts safe. */ }
    draftPersistedRef.current = persisted
    setDraftPersisted(persisted)
  }

  function updateDraft(comment: string) {
    if (!doc || !pop) return
    const key = noteDraftKey(doc.sourcePath, pop.lang, pop.block)
    const next = { ...draftsRef.current }
    if (comment) next[key] = { quote: pop.quote, comment, quoteAnchor: pop.quoteAnchor }
    else delete next[key]
    persistDrafts(next)
    setNoteError('')
  }

  function discardDraft(key: string) {
    const next = { ...draftsRef.current }
    delete next[key]
    persistDrafts(next)
  }

  function draftLocation(entry: NoteDraftEntry) {
    return {
      blockId: entry.kind === 'id' ? entry.target : null,
      blockKey: entry.kind === 'key' ? entry.target : null,
      quote: entry.quote,
      quoteLang: entry.lang,
      quoteAnchor: entry.quoteAnchor
    }
  }

  function editNote(note: Note) {
    if (!doc) return
    const draftKey = editNoteDraftKey(doc.sourcePath, note.quoteLang, note.id)
    const location = resolveNoteBlock(note, doc.source.blocks, doc.zh?.blocks ?? null)
    editingRef.current = true
    setPop(null)
    setNoteError('')
    setNoteEditor({
      sourcePath: doc.sourcePath, draftKey, noteId: note.id,
      quote: draftsRef.current[draftKey]?.quote ?? note.quote, lang: note.quoteLang,
      blockId: note.blockId, blockKey: location.block?.key ?? note.blockKey, quoteAnchor: draftsRef.current[draftKey]?.quoteAnchor ?? note.quoteAnchor,
      originalComment: note.comment, unavailable: false,
      warning: location.block ? undefined : t(ui, 'originalUnavailable')
    })
  }

  async function resumeDraft(key: string) {
    const entry = listNoteDrafts(draftsRef.current).find((draft) => draft.key === key)
    if (!entry) return
    let current = doc
    let request = documentRequest.current
    if (current?.sourcePath !== entry.sourcePath) {
      const opening = openDoc(entry.sourcePath, true)
      request = documentRequest.current
      current = await opening
    }
    if (request !== documentRequest.current) return
    const saved = entry.kind === 'note' ? current?.notes.find((note) => note.id === entry.target) : undefined
    const target = saved ?? draftLocation(entry)
    const location = resolveNoteBlock(target, current?.source.blocks ?? [], current?.zh?.blocks ?? null)
    editingRef.current = true
    setPop(null)
    setNoteError('')
    setNoteEditor({
      sourcePath: entry.sourcePath, draftKey: key, quote: entry.quote, lang: entry.lang, quoteAnchor: saved?.quoteAnchor ?? entry.quoteAnchor,
      noteId: entry.kind === 'note' ? entry.target : undefined,
      blockId: entry.kind !== 'note' && location.block ? location.block.id : target.blockId, blockKey: location.block?.key ?? target.blockKey,
      originalComment: saved?.comment ?? '',
      unavailable: !current || (entry.kind === 'note' ? !saved : !location.block),
      warning: !current ? t(ui, 'originalUnavailable')
        : entry.kind === 'note' && !saved ? t(ui, 'noteDeleted')
        : !location.block || !location.quoteFound ? t(ui, 'originalUnavailable') : undefined
    })
    setNotesOpen(true)
    setWordsOpen(false)
    if (current && location.block) revealBlock(current.sourcePath, location.block.key, entry.lang)
  }

  function updateEditorDraft(comment: string) {
    if (!noteEditor) return
    const next = { ...draftsRef.current }
    if (noteEditor.noteId ? comment === noteEditor.originalComment : !comment) delete next[noteEditor.draftKey]
    else next[noteEditor.draftKey] = { quote: noteEditor.quote, comment, quoteAnchor: noteEditor.quoteAnchor }
    persistDrafts(next)
    setNoteError('')
  }

  async function saveEditorNote() {
    if (!noteEditor || noteEditor.unavailable) return
    const comment = draftsRef.current[noteEditor.draftKey]?.comment ?? noteEditor.originalComment
    const note: Note = {
      id: noteEditor.noteId ?? crypto.randomUUID(), blockId: noteEditor.blockId, blockKey: noteEditor.blockKey,
      quote: noteEditor.quote, quoteLang: noteEditor.lang, quoteAnchor: noteEditor.quoteAnchor, comment: comment.trim(),
      createdAt: new Date().toISOString(), status: 'open'
    }
    await commitNote(noteEditor.sourcePath, note, noteEditor.draftKey, comment, noteEditor)
  }

  function learnWord(block: Block, word: string, rect: DOMRect, sentence?: string, occurrence?: string) {
    openWordCard(block, word, rect.left + rect.width / 2, rect.bottom + 8, false, sentence, occurrence)
  }

  function openWordCard(block: Block, word: string, x: number, y: number, read = false, context?: string, wordOccurrence?: string, keyboard = false) {
    if (!doc) return
    const sentence = context || sentenceAround(block.text, word)
    const saved = doc.words.find((item) => item.key === wordKey(word) && item.sentence === sentence)
    const explanation = savedWordExplanation(saved, sentence)
    const lookupId = crypto.randomUUID()
    const sourcePath = doc.sourcePath
    const requestKey = JSON.stringify([sourcePath, wordKey(word)])
    if (wordRequests.current.size > 200) wordRequests.current.clear()
    wordRequests.current.set(requestKey, lookupId)
    editingRef.current = true
    const target: Popover = {
      block, quote: word, lang: 'source', mode: 'learn', sentence, lookupId, sourcePath, wordOccurrence, keyboard,
      explanation, loading: !explanation && !!state?.hasKey, dictionaryLoading: true, x, y
    }
    setPop(target)
    if (read) speech.speak(`word:${wordKey(word)}`, word)
    void fetchWordDictionary(target)
    if (!explanation && state?.hasKey) void fetchWordExplanation(target, false)
  }

  function updateWordCard(target: Popover, update: Partial<Popover>) {
    setPop((current) => current?.mode === 'learn' && current.lookupId === target.lookupId
      ? { ...current, ...update } : current)
  }

  async function fetchWordDictionary(target: Popover) {
    updateWordCard(target, { dictionaryLoading: true })
    try {
      const dictionary = await window.api.lookupDictionary(target.quote)
      updateWordCard(target, { dictionary, dictionaryLoading: false })
    } catch {
      updateWordCard(target, {
        dictionaryLoading: false,
        dictionary: { word: target.quote, status: 'unavailable', pronunciations: [], definitions: [] }
      })
    }
  }

  async function fetchWordExplanation(target: Popover, detail: boolean) {
    if (!state?.hasKey || !target.lookupId || !target.sourcePath || !target.sentence) return
    updateWordCard(target, detail ? { busy: true, detailError: undefined } : { loading: true, error: undefined })
    let result: WordExplanation
    try {
      result = await window.api.explainWord(target.quote, target.sentence, detail)
      updateWordCard(target, detail
        ? { details: result, busy: false }
        : { explanation: result, loading: false })
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      const message = code.includes('ERR_BAD_EXPLANATION')
        ? t(ui, 'wordExplanationFailed') : errorText(ui, code, 'glossFailed')
      updateWordCard(target, detail ? { busy: false, detailError: message } : { loading: false, error: message })
      return
    }
    if (detail) return
    const sourcePath = target.sourcePath
    if (wordRequests.current.get(JSON.stringify([sourcePath, wordKey(target.quote)])) !== target.lookupId) return
    const saved = doc?.sourcePath === sourcePath ? doc.words.find((item) => item.key === wordKey(target.quote)) : undefined
    try {
      const entry: LearnedWord = {
        id: saved?.id ?? crypto.randomUUID(),
        word: target.quote,
        key: wordKey(target.quote),
        sentence: target.sentence,
        meaning: result.meaning,
        explanation: result,
        blockId: target.block.id,
        createdAt: saved?.createdAt ?? new Date().toISOString()
      }
      const words = await window.api.saveWord(sourcePath, entry)
      setDoc((current) => current?.sourcePath === sourcePath ? { ...current, words } : current)
    } catch (error) {
      const message = reviewError(error, 'wordSaveFailed')
      updateWordCard(target, { error: message })
      flashToast(message)
    }
  }

  function setWords(words: LearnedWord[], sourcePath: string) {
    setDoc((current) => (current?.sourcePath === sourcePath ? { ...current, words } : current))
  }

  function translateBlock(block: Block, lang: 'source' | 'zh') {
    openPopover(block, block.text.trim(), lang, 'gloss')
    void runGloss(false, block, block.text.trim(), lang)
  }

  async function runGloss(detail: boolean, block?: Block, quote?: string, lang?: 'source' | 'zh') {
    const target = block && quote && lang ? { block, quote, lang } : pop
    if (!target) return
    if (!detail && !block && pop && target.lang === 'source' && /^[A-Za-z]+(?:['’-][A-Za-z]+)*$/.test(target.quote.trim())) {
      openWordCard(target.block, target.quote.trim(), pop.x, pop.y, false, pop.sentence)
      return
    }
    if (!state?.hasKey) {
      setPop((p) => (p ? { ...p, mode: 'gloss', gloss: 'NO_KEY' } : p))
      return
    }
    const sentence = sentenceAround(target.block.text, target.quote)
    const lookupId = crypto.randomUUID()
    setPop((p) => (p ? { ...p, mode: 'gloss', lookupId, loading: !detail, busy: detail } : p))
    try {
      const result = await window.api.gloss(target.quote, sentence, detail)
      setPop((p) => (p?.mode === 'gloss' && p.lookupId === lookupId ? { ...p, loading: false, busy: false, ...(detail ? { detail: result.text } : { gloss: result.text }) } : p))
    } catch (error) {
      const message = errorText(ui, error instanceof Error ? error.message : '', 'glossFailed')
      setPop((p) => (p?.mode === 'gloss' && p.lookupId === lookupId ? { ...p, loading: false, busy: false, gloss: message === 'NO_KEY' ? 'NO_KEY' : message } : p))
    }
  }

  async function saveNote(comment: string) {
    if (!pop || !doc) return
    const note: Note = {
      id: crypto.randomUUID(), blockId: pop.block.id, blockKey: pop.block.key,
      quote: pop.quote, quoteLang: pop.lang, quoteAnchor: pop.quoteAnchor, comment: comment.trim(),
      createdAt: new Date().toISOString(), status: 'open'
    }
    await commitNote(doc.sourcePath, note, noteDraftKey(doc.sourcePath, pop.lang, pop.block), comment, pop)
  }

  async function commitNote(sourcePath: string, note: Note, draftKey: string, comment: string, target: Popover | NoteEditorTarget) {
    if (!comment.trim() || savingNoteRef.current) return
    const isEdit = 'noteId' in target && !!target.noteId
    savingNoteRef.current = true
    setNoteSaving(true)
    setNoteError('')
    const stillEditing = () => {
      const active = activeContextRef.current
      return active.sourcePath === sourcePath && (active.pop === target || active.noteEditor === target)
    }
    try {
      const result = isEdit
        ? await window.api.editNote(sourcePath, note.id, comment)
        : await window.api.saveNote(sourcePath, note)
      setDoc((current) => current?.sourcePath === sourcePath
        ? { ...current, notesMissing: result.notesMissing, reviewIssue: result.reviewIssue, legacyUnassigned: result.legacyUnassigned, words: result.words ?? current.words, notes: reconcileNotes(result.notes, current.source.blocks, current.zh?.blocks ?? null) }
        : current)
      // Only clear the exact revision that reached disk.
      if (draftsRef.current[draftKey]?.comment === comment) discardDraft(draftKey)
      if (stillEditing()) {
        setPop(null)
        setNoteEditor(null)
        setNotesOpen(true)
        setWordsOpen(false)
        setActiveNote(note.id)
      }
      flashToast(t(ui, isEdit ? 'noteUpdated' : 'noteAdded'))
    } catch (error) {
      const message = error instanceof Error && error.message.includes('ERR_NOTE_MISSING')
        ? t(ui, 'noteDeleted') : reviewError(error, 'noteSaveFailed')
      if (error instanceof Error && error.message.includes('REVIEW_')) await refreshReviewState(sourcePath)
      if (stillEditing()) setNoteError(message)
      else flashToast(message)
    } finally {
      savingNoteRef.current = false
      setNoteSaving(false)
    }
  }

  async function copyTasks(list: Note[]) {
    if (!doc || list.length === 0) return
    const folder = doc.sourcePath.split(/[/\\]/).slice(-2, -1)[0] || fileTitle(doc.sourcePath)
    await window.api.copyText(formatTasks(list, { folder, source: doc.source.blocks, zh: doc.zh?.blocks ?? null }, ui))
    flashToast(list.length > 1 ? t(ui, 'copiedTasks', { n: list.length }) : t(ui, 'copiedTask'))
  }

  function revealBlock(sourcePath: string, key: string, lang: 'source' | 'zh') {
    const nextMode = noteReadMode(mode, lang)
    setPendingJump({ sourcePath, key, lang })
    if (nextMode !== mode) void savePrefs({ mode: nextMode })
  }

  function jumpToNote(note: Note) {
    if (!doc) return
    const location = resolveNoteBlock(note, doc.source.blocks, doc.zh?.blocks ?? null)
    if (!location.block) {
      flashToast(t(ui, location.reason === 'translation-missing' ? 'translationUnavailable' : 'noteLocateFailed'))
      return
    }
    const key = location.block.key
    setActiveNote(note.id)
    setDoc((current) => current ? { ...current, notes: current.notes.map((item) => item.id === note.id ? { ...item, blockKey: key } : item) } : current)
    revealBlock(doc.sourcePath, key, note.quoteLang)
    if (!location.quoteFound) flashToast(t(ui, 'originalUnavailable'))
  }

  function jumpToHeading(key: string) {
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-key="${cssEscape(key)}"]`)
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  async function onDropPath(path: string) {
    try {
      const { state: next, openPath } = await window.api.openPath(path)
      applyState(next, openPath)
    } catch (error) {
      flashToast(errorText(ui, error instanceof Error ? error.message : '', 'cannotOpen'))
    }
  }

  function flashToast(message: string) {
    setToast(message)
    window.setTimeout(() => setToast(''), 1800)
  }
}

/* ---------- Sidebar ---------- */

function Sidebar({
  state,
  visible,
  doc,
  onOpen,
  onPrefs,
  onJump,
  onPickRoot,
  onFileMenu
}: {
  state: AppState
  visible: boolean
  doc: Doc | null
  onOpen: (path: string) => void
  onPrefs: (patch: Partial<Preferences>) => void
  onJump: (key: string) => void
  onPickRoot: () => void
  onFileMenu: (path: string, position: { x: number; y: number }) => void
}) {
  const tr = useT()
  if (!visible) return null
  const tab = state.prefs.sidebarTab
  const folderName = state.root?.split(/[/\\]/).filter(Boolean).pop() ?? tr('folderFallback')
  return (
    <aside className="sidebar">
      <div className="sidebar-drag" />
      <div className="sidebar-tabs">
        <button className={tab === 'files' ? 'on' : ''} aria-pressed={tab === 'files'} onClick={() => onPrefs({ sidebarTab: 'files' })}>
          {tr('articles')}
        </button>
        <button className={tab === 'outline' ? 'on' : ''} aria-pressed={tab === 'outline'} onClick={() => onPrefs({ sidebarTab: 'outline' })}>
          {tr('outline')}
        </button>
      </div>
      <div className="sidebar-scroll">
        {tab === 'files' ? (
          state.library.length === 0 ? (
            <p className="empty-notes">{tr('noMarkdown')}</p>
          ) : (
            <div className="article-list">
              {state.library.map((entry) => {
                const isCurrent = entry.path === doc?.sourcePath
                const filename = entry.path.split(/[/\\]/).pop() ?? ''
                return (
                  <div
                    key={entry.path}
                    className={`entry ${isCurrent ? 'on' : ''}`}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      onFileMenu(entry.path, { x: event.clientX, y: event.clientY })
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') {
                        event.preventDefault()
                        const target = event.target as HTMLElement
                        const rect = target.getBoundingClientRect()
                        onFileMenu(entry.path, { x: rect.left, y: rect.bottom })
                      }
                    }}
                  >
                    <button
                      className="entry-open"
                      aria-current={isCurrent ? 'page' : undefined}
                      title={`${entry.title}\n${entry.path}${entry.zhPath ? `\n${tr('bilingualTag')}` : ''}`}
                      onClick={() => onOpen(entry.path)}
                    >
                      <span className="t">{entry.title}</span>
                      <span className="entry-path" title={entry.path}>
                        {entry.folder !== '.' && <><span className="entry-folder">{entry.folder}</span><span>/</span></>}
                        <span className="entry-filename">{filename}</span>
                      </span>
                    </button>
                    <button
                      className="entry-actions"
                      aria-label={`${tr('fileActions')}: ${entry.title}`}
                      aria-haspopup="menu"
                      title={tr('fileActionsHint')}
                      onClick={(event) => {
                        const rect = event.currentTarget.getBoundingClientRect()
                        onFileMenu(entry.path, { x: rect.left, y: rect.bottom })
                      }}
                    >
                      <MoreHorizontal size={16} />
                    </button>
                  </div>
                )
              })}
            </div>
          )
        ) : doc ? (
          <Outline doc={doc} onJump={onJump} />
        ) : (
          <p className="empty-notes">{tr('outlineEmpty')}</p>
        )}
      </div>
      <div className="sidebar-foot">
        <button className="btn ghost small" onClick={onPickRoot} title={`${state.root ?? ''}\n${tr('openOtherFolder')}`}>
          <FolderOpen size={15} /> <span className="folder-name">{folderName}</span>
        </button>
      </div>
    </aside>
  )
}

function Outline({ doc, onJump }: { doc: Doc; onJump: (key: string) => void }) {
  const headings = doc.source.blocks.filter((block) => block.kind === 'heading')
  const tr = useT()
  if (headings.length === 0) return <p className="empty-notes">{tr('noHeadings')}</p>
  return (
    <>
      {headings.map((h) => (
        <button
          key={h.key}
          className="outline-item"
          style={{ paddingLeft: 10 + h.depth * 12 }}
          onClick={() => onJump(h.key)}
        >
          {h.text}
        </button>
      ))}
    </>
  )
}

/* ---------- Topbar ---------- */

function Topbar({
  doc,
  prefs,
  sidebarVisible,
  onToggleSidebar,
  onSettings,
  hasZh,
  openCount,
  notesOpen,
  wordCount,
  wordsOpen,
  status,
  speechNote,
  onPrefs,
  onToggleNotes,
  onToggleWords,
  onReadMode
}: {
  doc: Doc | null
  prefs: Preferences
  sidebarVisible: boolean
  onToggleSidebar: () => void
  onSettings: () => void
  hasZh: boolean
  openCount: number
  notesOpen: boolean
  wordCount: number
  wordsOpen: boolean
  status: string
  speechNote: string
  onPrefs: (patch: Partial<Preferences>) => void
  onToggleNotes: () => void
  onToggleWords: () => void
  onReadMode: (mode: ReadMode) => void
}) {
  const tr = useT()
  const busy = status || speechNote
  const preparing = status === 'updating' || speechNote === 'preparing' || speechNote === 'prepare' || speechNote.startsWith('download:')
  const busyLabel = status === 'updating' ? tr('updating') : speechText(prefs.ui ?? 'en', speechNote)
  return (
    <div className="topbar">
      {!sidebarVisible && <span className="pad" />}
      <button className="btn icon ghost" title={sidebarVisible ? tr('collapseSidebar') : tr('expandSidebar')} aria-label={sidebarVisible ? tr('collapseSidebar') : tr('expandSidebar')} onClick={onToggleSidebar}>
        {sidebarVisible ? <PanelLeft size={16} /> : <PanelRight size={16} />}
      </button>
      <span className="title" title={doc?.source.title}>{doc?.source.title ?? ''}</span>
      {busy ? (
        <span className="status-pill" role="status" title={busyLabel}>
          {preparing && <Loader2 className="spin" size={13} />} {busyLabel}
        </span>
      ) : null}
      <div className="seg read-modes" role="group" aria-label={tr('readingMode')}>
        <button className={prefs.mode === 'source' ? 'on' : ''} aria-pressed={prefs.mode === 'source'} onClick={() => onReadMode('source')} title={tr('readEnglishTitle')}>
          {tr('readEnglish')}
        </button>
        <button className={prefs.mode === 'zh' ? 'on' : ''} aria-pressed={prefs.mode === 'zh'} disabled={!doc} onClick={() => onReadMode('zh')} title={tr('readChineseTitle')}>
          {tr('readChinese')}
        </button>
        <button
          className={prefs.mode === 'bilingual' ? 'on' : ''}
          aria-pressed={prefs.mode === 'bilingual'}
          disabled={!doc}
          onClick={() => onReadMode('bilingual')}
          title={tr('readBothTitle')}
        >
          <BookOpen size={14} /> {tr('readBoth')}
        </button>
      </div>
      <button className={`btn ghost panel-toggle ${notesOpen ? 'active' : ''}`} onClick={onToggleNotes} title={tr('notes')} aria-label={tr('notes')} aria-expanded={notesOpen}>
        {openCount > 0 ? <MessageSquareText size={16} /> : <MessageSquarePlus size={16} />}
        <span className="control-label">{tr('notes')}</span>
        {openCount > 0 && <span className="control-count">{openCount}</span>}
      </button>
      <div className="reader-tools">
        <ReadingOptions fontSize={prefs.fontSize} onChange={(fontSize) => onPrefs({ fontSize })} />
        <button className={`btn icon ghost ${wordsOpen ? 'active' : ''}`} onClick={onToggleWords} title={`${tr('words')}${wordCount > 0 ? ` · ${wordCount}` : ''}`} aria-label={tr('words')} aria-expanded={wordsOpen}>
          <Languages size={16} />
        </button>
        <button className="btn icon ghost" title={tr('settings')} aria-label={tr('settings')} onClick={onSettings}>
          <Settings size={16} />
        </button>
      </div>
    </div>
  )
}

/* ---------- Reader ---------- */

function reviewIssueMessage(doc: Doc, ui: UiLang) {
  if (!doc.reviewIssue || doc.reviewIssue === 'missing') return t(ui, 'notesFileMissing')
  if (doc.reviewIssue === 'corrupt') return ui === 'zh'
    ? doc.notesMissing ? '批注文件损坏，当前显示的是备份。恢复时会保留损坏原件。' : '批注文件或备份无法读取，原文件已保留。请检查文件后再保存。'
    : doc.notesMissing ? 'The review file is damaged. Your backup is shown below. The damaged original will be preserved when restoring.' : 'The review file or backup cannot be read. The original is preserved. Check the files before saving.'
  if (doc.reviewIssue === 'unsafe') return errorText(ui, 'REVIEW_PATH_UNSAFE', 'noteSaveFailed')
  if (doc.reviewIssue === 'legacy-corrupt') return errorText(ui, 'REVIEW_LEGACY_CORRUPT', 'noteSaveFailed')
  if (doc.reviewIssue === 'backup-unavailable') return ui === 'zh' ? '备份暂时无法保存，已有批注仍可查看。请检查应用数据目录权限后重试。' : 'The backup could not be saved. Existing notes are still visible. Check access to the app data folder and try again.'
  return ui === 'zh' ? '批注数据暂时无法读取，原文件未改动。请检查文件权限，或稍后重新打开文章。' : 'Review data is temporarily unavailable. The original files are unchanged. Check file access or reopen the article shortly.'
}

function Reader({
  doc,
  mode,
  showZh,
  aligned,
  pairing,
  onCheckPairing,
  flash,
  notes,
  speaking,
  onImage,
  onSpeak,
  onSelect,
  onAnnotate,
  onTranslate,
  onWord,
  knownWords,
  activeWord,
  restoring,
  onRestore,
  onRevealLegacy,
  onCloseDocument,
  onAssociated
}: {
  doc: Doc
  mode: ReadMode
  showZh: boolean
  aligned: ReturnType<typeof alignBlocks> | null
  pairing: ReturnType<typeof inspectPairing> | null
  onCheckPairing: () => void
  flash: Set<string>
  notes: Note[]
  speaking: { key: string; paused: boolean; preparing: boolean } | null
  onImage: (src: string) => void
  onSpeak: (block: Block, lang: 'source' | 'zh') => void
  onSelect: (block: Block, quote: string, lang: 'source' | 'zh', rect: DOMRect, sentence?: string, quoteAnchor?: QuoteAnchor) => void
  onAnnotate: (block: Block, lang: 'source' | 'zh') => void
  onTranslate: (block: Block, lang: 'source' | 'zh') => void
  onWord: (block: Block, word: string, rect: DOMRect, sentence?: string, occurrence?: string) => void
  knownWords: Set<string>
  activeWord: string | null
  restoring: boolean
  onRestore: () => void
  onRevealLegacy: () => void
  onCloseDocument: () => void
  onAssociated: (result: NotesResult, sourcePath: string) => void
}) {
  const tr = useT()
  const ui = useUi()
  const wide = mode === 'bilingual'
  const readerRef = useRef<HTMLDivElement>(null)
  const [hasTextSelection, setHasTextSelection] = useState(false)
  useEffect(() => {
    const update = () => {
      const selection = window.getSelection()
      setHasTextSelection(!!selection && !selection.isCollapsed && !!readerRef.current?.contains(selection.anchorNode))
    }
    document.addEventListener('selectionchange', update)
    return () => document.removeEventListener('selectionchange', update)
  }, [])
  const primary = showZh && doc.zh ? doc.zh : doc.source
  const warnings = mode === 'source' ? doc.source.warnings : mode === 'zh' ? doc.zh?.warnings ?? [] : [...doc.source.warnings, ...(doc.zh?.warnings ?? [])]

  const onMouseUp = (block: Block, lang: 'source' | 'zh') => {
    const sel = window.getSelection()
    const quote = sel?.toString().trim() ?? ''
    if (!quote || !sel || sel.rangeCount === 0) return
    const anchor = nodeEl(sel.anchorNode)?.closest('[data-key]')
    const focus = nodeEl(sel.focusNode)?.closest('[data-key]')
    if (!anchor || anchor !== focus || anchor.getAttribute('data-key') !== block.key) return
    const range = sel.getRangeAt(0)
    const captured = quoteSelectionForRange(block, anchor, range)
    onSelect(block, captured?.quote ?? quote, lang, range.getBoundingClientRect(), sentenceForRange(range), captured?.quoteAnchor)
  }

  const render = (block: Block, lang: 'source' | 'zh') => (
    <div key={`${lang}:${block.key}`} onMouseUp={() => onMouseUp(block, lang)}>
      <BlockView
        block={block}
        dir={lang === 'zh' ? doc.zhDir ?? doc.dir : doc.dir}
        version={doc.assetVersion}
        lang={lang}
        notes={notes}
        flash={flash.has(`${lang}:${block.key}`)}
        speaking={lang === 'source' && speaking?.key === block.key}
        paused={speaking?.paused ?? false}
        preparing={speaking?.preparing ?? false}
        onImage={onImage}
        onSpeak={lang === 'source' ? (b) => onSpeak(b, lang) : undefined}
        onAnnotate={(b) => onAnnotate(b, lang)}
        onTranslate={(b) => onTranslate(b, lang)}
        learn={
          lang === 'source'
            ? { known: knownWords, active: activeWord, onWord: (word, rect, sentence, occurrence) => onWord(block, word, rect, sentence, occurrence) }
            : undefined
        }
      />
    </div>
  )

  return (
    <div ref={readerRef} className={`reader ${wide ? 'wide' : ''}${hasTextSelection ? ' has-text-selection' : ''}`}>
      {doc.missing && <div className="banner source-missing-banner" role="status">
        <FileText size={15} aria-hidden="true" />
        <span>{ui === 'zh' ? '原文件已移走或无法读取。当前显示缓存正文。' : 'The source file is missing or unreadable. This is the last loaded text.'}</span>
        <button className="btn small ghost" onClick={() => void window.api.pickFile()}>{ui === 'zh' ? '重新选择文件' : 'Choose a file'}</button>
        <button className="btn small ghost" onClick={onCloseDocument}>{ui === 'zh' ? '关闭文章' : 'Close article'}</button>
      </div>}
      <DocHeader doc={doc} mode={mode} />
      {mode === 'bilingual' && pairing && <PairingStatus report={pairing} ui={ui} onCheck={onCheckPairing} />}
      <ReviewAssociation sourcePath={doc.sourcePath}
        eligible={!doc.missing && !doc.notesMissing && !doc.reviewIssue && notes.length === 0 && doc.words.length === 0}
        onAssociated={onAssociated} />
      {mode !== 'bilingual' && warnings.length > 0 && (
        <div className={`banner ${wide ? 'wide' : ''}`}>
          <Sparkles size={14} /> {warningText(ui, warnings[0])}
        </div>
      )}
      {(doc.reviewIssue || doc.notesMissing) && (
        <div className={`banner review-banner ${wide ? 'wide' : ''}`} role="status">
          <Undo2 size={14} aria-hidden="true" />
          <span>{reviewIssueMessage(doc, ui)}</span>
          {doc.notesMissing && <button className="btn small ghost" disabled={restoring} onClick={onRestore}>{tr(restoring ? 'restoringReview' : 'restoreReview')}</button>}
        </div>
      )}
      {!!doc.legacyUnassigned && (
        <div className={`banner review-banner ${wide ? 'wide' : ''}`} role="status">
          <span>{tr('legacyReviewNotice', { n: doc.legacyUnassigned })}</span>
          <button className="btn small ghost" onClick={onRevealLegacy}>{tr('revealLegacyReview')}</button>
        </div>
      )}

      {mode === 'bilingual' && aligned && !aligned.independent ? (
        <div className="pairs prose">
          {aligned.rows.map((row) => (
            <div className="pair" key={row.key}>
              {row.source ? render(row.source, 'source') : <div className="blk missing">{tr('missingEnglish')}</div>}
              {row.zh ? render(row.zh, 'zh') : <div className="blk missing">{tr('missingChinese')}</div>}
            </div>
          ))}
        </div>
      ) : mode === 'bilingual' && doc.zh ? (
        <>
          <div className="cols">
            <div className="col prose">
              <span className="lang-badge">{tr('columnEnglish')}</span>
              {doc.source.blocks.map((block) => render(block, 'source'))}
            </div>
            <div className="col prose">
              <span className="lang-badge">{tr('columnChinese')}</span>
              {doc.zh.blocks.map((block) => render(block, 'zh'))}
            </div>
          </div>
        </>
      ) : (
        <div className="prose">{primary.blocks.map((block) => render(block, showZh ? 'zh' : 'source'))}</div>
      )}
    </div>
  )
}

function DocHeader({ doc, mode }: { doc: Doc; mode: ReadMode }) {
  const tr = useT()
  const parsed = mode === 'zh' && doc.zh ? doc.zh : doc.source
  const seo = parsed.seo
  const hasBodyTitle = parsed.blocks.some((block) => block.kind === 'heading' && block.depth === 0)
  if (hasBodyTitle && !seo.title && !seo.description) return null
  return (
    <div className="doc-header">
      {!hasBodyTitle && <h1>{parsed.title}</h1>}
      {(seo.title || seo.description) && (
        <div className="seo">
          {seo.title && (
            <div className="row">
              <span className="k">{tr('seoTitle')}</span>
              <span>{seo.title}</span>
            </div>
          )}
          {seo.description && (
            <div className="row">
              <span className="k">{tr('seoDescription')}</span>
              <span>{seo.description}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function WordsPanel({
  words,
  onListen,
  onDelete,
  onClose
}: {
  words: LearnedWord[]
  onListen: (item?: LearnedWord) => void
  onDelete: (id: string) => void
  onClose: () => void
}) {
  const tr = useT()
  return (
    <aside className="notes">
      <div className="notes-head">
        {tr('words')}
        <div style={{ flex: 1 }} />
        <button className="btn small ghost" disabled={words.length === 0} onClick={() => onListen()}>
          <Volume2 size={14} /> {tr('listenWords')}
        </button>
        <button className="btn icon ghost" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="notes-scroll">
        {words.length === 0 && <p className="empty-notes">{tr('wordsEmpty')}</p>}
        {words.map((item) => (
          <div key={item.id} className="note">
            <button className="quote" onClick={() => onListen(item)}>
              {item.word}
            </button>
            <div className="comment">{item.meaning}</div>
            <div className="foot">
              <span className="chip">{tr('savedHere')}</span>
              <div className="spacer" />
              <button className="btn small ghost" onClick={() => onDelete(item.id)} title={tr('delete')}>
                <Trash size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}

/* ---------- Selection popover ---------- */

function SelectionPopover({
  pop,
  comment,
  onComment,
  draftPersisted,
  noteSaving,
  noteError,
  onDiscardDraft,
  hasKey,
  onTranslate,
  onDetail,
  onAnnotate,
  onSpeak,
  onSaveNote,
  onClose,
  onSettings,
  onRestore,
  restoring
}: {
  pop: Popover
  comment: string
  onComment: (comment: string) => void
  draftPersisted: boolean
  noteSaving: boolean
  noteError: string
  onDiscardDraft: () => void
  hasKey: boolean
  onTranslate: () => void
  onDetail: () => void
  onAnnotate: () => void
  onSpeak: () => void
  onSaveNote: (comment: string) => void
  onClose: () => void
  onSettings: () => void
  onRestore?: () => void
  restoring?: boolean
}) {
  const tr = useT()
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 12, top: 64 })
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const place = () => {
      const size = element.getBoundingClientRect()
      const anchor = pop.anchor ?? { left: pop.x - size.width / 2, right: pop.x, top: pop.y - 8, bottom: pop.y - 8 }
      const top = (document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0) + 8
      const occupied: SelectionRect[] = []
      if (pop.mode === 'menu') {
        for (const text of document.querySelectorAll('.reader .text, .reader pre, .reader table, .reader img')) {
          const bounds = text.getBoundingClientRect()
          if (bounds.bottom < top || bounds.top > window.innerHeight) continue
          if (text.matches('.text')) {
            const range = document.createRange()
            range.selectNodeContents(text)
            occupied.push(...Array.from(range.getClientRects()))
          } else occupied.push(bounds)
        }
      }
      const next = selectionPosition(anchor, size, { width: window.innerWidth, height: window.innerHeight, top }, occupied)
      setPosition((current) => current.left === next.left && current.top === next.top ? current : next)
    }
    place()
    const previous = document.activeElement as HTMLElement | null
    if (pop.keyboard) element.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
    const observer = new ResizeObserver(place)
    observer.observe(element)
    const onDown = (event: PointerEvent) => {
      if (!element.contains(event.target as Node)) closeRef.current()
    }
    const onScroll = (event: Event) => {
      if (pop.mode === 'menu' && !element.contains(event.target as Node)) closeRef.current()
    }
    const onResize = () => pop.mode === 'menu' ? closeRef.current() : place()
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      const focusInside = element.contains(document.activeElement)
      observer.disconnect()
      if (pop.keyboard && focusInside && previous?.isConnected) previous.focus({ preventScroll: true })
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [pop.x, pop.y, pop.anchor, pop.mode, pop.keyboard])

  return (
    <div className={`pop selection-popover${pop.mode === 'menu' ? ' selection-menu' : ''}`} ref={ref}
      style={{ ...position, width: pop.mode === 'menu' ? 'max-content' : 340, maxWidth: 'calc(100vw - 24px)', maxHeight: 'calc(100vh - 84px)', overflowY: 'auto' }}
      role="dialog" aria-label={pop.mode === 'note' ? tr('annotate') : tr('glossTitle')}>
      {pop.mode === 'menu' && (
        <div className="actions only">
          {isLatin(pop.quote) && (
            <button className="btn small ghost" onMouseDown={(e) => e.preventDefault()} onClick={onTranslate}>
              <Languages size={14} /> {tr('translate')}
            </button>
          )}
          {isLatin(pop.quote) && (
            <button className="btn small ghost" onMouseDown={(e) => e.preventDefault()} onClick={onSpeak}>
              <Volume2 size={14} /> {tr('speak')}
            </button>
          )}
          <button className="btn small ghost" onMouseDown={(e) => e.preventDefault()} onClick={onAnnotate}>
            <MessageSquarePlus size={14} /> {tr('annotate')}
          </button>
        </div>
      )}

      {pop.mode === 'gloss' && (
        <>
          <div className="quoted">{pop.quote}</div>
          <div className="body">
            {pop.gloss === 'NO_KEY' ? (
              <div>
                <div className="head">
                  <Languages size={13} /> {tr('needKey')}
                </div>
                {tr('needKeyBody')}
                <button className="more" onClick={onSettings}>{tr('goSettings')}</button>
              </div>
            ) : (
              <>
                <div className="head">
                  <Languages size={13} /> {tr('glossTitle')}
                </div>
                {pop.loading ? (
                  <span className="chip">
                    <Loader2 className="spin" size={12} /> {tr('translating')}
                  </span>
                ) : (
                  <div style={{ whiteSpace: 'pre-wrap' }}>{pop.gloss}</div>
                )}
                {pop.detail && <div style={{ whiteSpace: 'pre-wrap', marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)' }}>{pop.detail}</div>}
                {!pop.detail && !pop.loading && pop.gloss && hasKey && (
                  <button className="more" disabled={pop.busy} onClick={onDetail}>{pop.busy ? tr('explaining') : tr('explainMore')}</button>
                )}
                <div style={{ marginTop: 12, display: 'flex', gap: 6 }}>
                  <button className="btn small ghost" onClick={onAnnotate}>
                    <MessageSquarePlus size={13} /> {tr('toNote')}
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {pop.mode === 'note' && (
        <>
          <div className="quoted">{pop.quote}</div>
          <div className="note-form">
            <textarea
              autoFocus
              value={comment}
              aria-label={tr('notePlaceholder')}
              disabled={noteSaving}
              placeholder={tr('notePlaceholder')}
              onChange={(e) => onComment(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault()
                  if (!noteSaving) onSaveNote(comment)
                }
              }}
            />
            {comment && <p className="draft-hint">{tr(draftPersisted ? 'draftKept' : 'draftSessionOnly')}</p>}
            {noteError && <p className="note-error" role="alert">{noteError}</p>}
            {noteError && onRestore && <button className="btn small ghost" disabled={restoring} onClick={onRestore}>{tr(restoring ? 'restoringReview' : 'restoreReview')}</button>}
            <div className="row">
              {comment && (
                <button className="btn small ghost" onClick={onDiscardDraft} disabled={noteSaving}>
                  {tr('discardDraft')}
                </button>
              )}
              <button className="btn small ghost" onClick={onClose}>
                {tr('close')}
              </button>
              <button className="btn small primary" disabled={noteSaving || !comment.trim()} onClick={() => onSaveNote(comment)}>
                {tr(noteSaving ? 'savingNote' : 'saveNote')}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/* ---------- Welcome ---------- */

function Welcome({
  dragOver,
  setDragOver,
  onDrop,
  noRoot,
  onPrefs,
  onSettings
}: {
  dragOver: boolean
  setDragOver: (v: boolean) => void
  onDrop: (path: string) => void
  noRoot: boolean
  onPrefs: (patch: Partial<Preferences>) => void
  onSettings: () => void
}) {
  const tr = useT()
  const ui = useUi()
  const [openingExample, setOpeningExample] = useState(false)
  const [exampleError, setExampleError] = useState(false)
  async function openExample() {
    if (openingExample) return
    setOpeningExample(true)
    setExampleError(false)
    try { await window.api.openExample() }
    catch { setExampleError(true) }
    finally { setOpeningExample(false) }
  }
  return (
    <div
      className={`welcome ${dragOver ? 'drag-over' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        const file = e.dataTransfer.files[0]
        if (file) onDrop(window.api.pathForFile(file))
      }}
    >
      <div className="welcome-controls">
        <div className="seg" role="group" aria-label={tr('language')}>
          <button aria-pressed={ui === 'zh'} className={ui === 'zh' ? 'on' : ''} onClick={() => onPrefs({ ui: 'zh' })}>中文</button>
          <button aria-pressed={ui === 'en'} className={ui === 'en' ? 'on' : ''} onClick={() => onPrefs({ ui: 'en' })}>English</button>
        </div>
        <button className="btn icon ghost" aria-label={tr('settings')} title={tr('settings')} onClick={onSettings}><Settings size={17} /></button>
      </div>
      <div className="card">
        <img className="logo" src={logoMark} alt="" />
        <h1>MD Duck</h1>
        <p>{tr('welcomeBody')}</p>
        <div className="row">
          <button className="btn primary" onClick={() => void window.api.pickRoot()}>
            <FolderOpen size={16} /> {tr('openFolder')}
          </button>
          <button className="btn ghost" onClick={() => void window.api.pickFile()}>
            <FileText size={16} /> {tr('openFile')}
          </button>
          {noRoot && (
            <button className="btn ghost" disabled={openingExample} onClick={() => void openExample()}>
              <Sparkles size={16} /> {tr(openingExample ? 'openingExample' : 'openExample')}
            </button>
          )}
        </div>
        {exampleError && <p role="alert">{tr('exampleOpenFailed')}</p>}
        <p className="hint">{tr('dropHint')}</p>
        <p className="welcome-reading-hint">{ui === 'zh' ? '点击英文单词查词，选中文字做批注。选中后也可按 ⌥ Enter。' : 'Click an English word to look it up. Select text to comment, or press Alt + Enter.'}</p>
      </div>
      {dragOver && (
        <div className="drop-veil">
          <div className="box">{tr('dropRelease')}</div>
        </div>
      )}
    </div>
  )
}

/* ---------- helpers ---------- */

function nodeEl(node: Node | null): HTMLElement | null {
  if (!node) return null
  return node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement
}

function currentSelectionRect() {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null
  const rect = sel.getRangeAt(0).getBoundingClientRect()
  return rect.width || rect.height ? rect : null
}

function sentenceAround(text: string, quote: string) {
  const clean = text.replace(/\s+/g, ' ').trim()
  const parts = clean.split(/(?<=[.!?。！？])\s+/)
  return parts.find((part) => part.includes(quote)) ?? clean.slice(0, 600)
}

function fileTitle(path: string) {
  return path.split(/[/\\]/).pop()?.replace(/\.(md|markdown)$/i, '') || 'article'
}

function cssEscape(value: string) {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&')
}
