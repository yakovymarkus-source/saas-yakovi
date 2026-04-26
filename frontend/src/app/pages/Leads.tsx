import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  Users, Search, Download, Trash2, ChevronLeft, ChevronRight,
  Loader2, Plus, Mail, Phone, Building2, Calendar, X,
  LayoutGrid, List, MessageSquare, Tag, StickyNote, ChevronDown,
} from 'lucide-react'
import { useAppState } from '../state/store'
import { useToast } from '../hooks/useToast'
import { sb } from '../api/client'

interface Lead {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  company: string | null
  source: string | null
  status: 'new' | 'contacted' | 'qualified' | 'converted' | 'lost'
  created_at: string
  notes: string | null
}

const STATUSES: Lead['status'][] = ['new', 'contacted', 'qualified', 'converted', 'lost']

const STATUS_META: Record<Lead['status'], { label: string; color: string; bg: string; border: string; dot: string }> = {
  new:       { label: 'חדש',          color: 'text-blue-400',   bg: 'bg-blue-500/15',   border: 'border-blue-500/30',   dot: 'bg-blue-400'   },
  contacted: { label: 'נוצר קשר',     color: 'text-yellow-400', bg: 'bg-yellow-500/15', border: 'border-yellow-500/30', dot: 'bg-yellow-400' },
  qualified: { label: 'מוסמך',        color: 'text-purple-400', bg: 'bg-purple-500/15', border: 'border-purple-500/30', dot: 'bg-purple-400' },
  converted: { label: 'הפך ללקוח',    color: 'text-green-400',  bg: 'bg-green-500/15',  border: 'border-green-500/30',  dot: 'bg-green-400'  },
  lost:      { label: 'אבד',          color: 'text-red-400',    bg: 'bg-red-500/15',    border: 'border-red-500/30',    dot: 'bg-red-400'    },
}

const EMPTY_FORM = { name: '', email: '', phone: '', company: '', source: '', status: 'new' as Lead['status'], notes: '' }

export function Leads() {
  const { state } = useAppState()
  const toast = useToast()
  const [leads, setLeads]           = useState<Lead[]>([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [filterStatus, setFilterStatus] = useState<Lead['status'] | 'all'>('all')
  const [view, setView]             = useState<'kanban' | 'table'>('kanban')
  const [selected, setSelected]     = useState<Lead | null>(null)
  const [showAdd, setShowAdd]       = useState(false)
  const [addForm, setAddForm]       = useState(EMPTY_FORM)
  const [saving, setSaving]         = useState(false)
  const [deleting, setDeleting]     = useState<string | null>(null)
  const [editNotes, setEditNotes]   = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const [movingId, setMovingId]     = useState<string | null>(null)

  useEffect(() => { if (state.user) loadLeads() }, [state.user])
  useEffect(() => { if (selected) setEditNotes(selected.notes || '') }, [selected])

  const loadLeads = async () => {
    setLoading(true)
    try {
      const { data, error } = await sb.from('leads').select('*')
        .eq('user_id', state.user!.id).order('created_at', { ascending: false })
      if (error) throw error
      setLeads((data || []) as Lead[])
    } catch { toast('שגיאה בטעינת לידים', 'error') }
    finally { setLoading(false) }
  }

  const addLead = async () => {
    if (!addForm.name && !addForm.email) { toast('נא למלא שם או מייל', 'warning'); return }
    setSaving(true)
    try {
      const { data, error } = await sb.from('leads').insert({
        user_id: state.user!.id,
        name: addForm.name || null,
        email: addForm.email || null,
        phone: addForm.phone || null,
        company: addForm.company || null,
        source: addForm.source || null,
        status: addForm.status,
        notes: addForm.notes || null,
      }).select().single()
      if (error) throw error
      setLeads(prev => [data as Lead, ...prev])
      setShowAdd(false)
      setAddForm(EMPTY_FORM)
      toast('ליד נוסף', 'success')
    } catch { toast('שגיאה בהוספה', 'error') }
    finally { setSaving(false) }
  }

  const moveStatus = async (lead: Lead, dir: 1 | -1) => {
    const idx = STATUSES.indexOf(lead.status)
    const next = STATUSES[idx + dir]
    if (!next) return
    setMovingId(lead.id)
    try {
      const { error } = await sb.from('leads').update({ status: next }).eq('id', lead.id)
      if (error) throw error
      const updated = { ...lead, status: next }
      setLeads(prev => prev.map(l => l.id === lead.id ? updated : l))
      if (selected?.id === lead.id) setSelected(updated)
    } catch { toast('שגיאה בעדכון', 'error') }
    finally { setMovingId(null) }
  }

  const changeStatus = async (lead: Lead, status: Lead['status']) => {
    setMovingId(lead.id)
    try {
      const { error } = await sb.from('leads').update({ status }).eq('id', lead.id)
      if (error) throw error
      const updated = { ...lead, status }
      setLeads(prev => prev.map(l => l.id === lead.id ? updated : l))
      if (selected?.id === lead.id) setSelected(updated)
    } catch { toast('שגיאה בעדכון', 'error') }
    finally { setMovingId(null) }
  }

  const saveNotes = async () => {
    if (!selected) return
    setSavingNotes(true)
    try {
      const { error } = await sb.from('leads').update({ notes: editNotes }).eq('id', selected.id)
      if (error) throw error
      const updated = { ...selected, notes: editNotes }
      setLeads(prev => prev.map(l => l.id === selected.id ? updated : l))
      setSelected(updated)
      toast('הערות נשמרו', 'success')
    } catch { toast('שגיאה בשמירה', 'error') }
    finally { setSavingNotes(false) }
  }

  const deleteLead = async (id: string) => {
    if (!confirm('למחוק ליד זה?')) return
    setDeleting(id)
    try {
      const { error } = await sb.from('leads').delete().eq('id', id)
      if (error) throw error
      setLeads(prev => prev.filter(l => l.id !== id))
      if (selected?.id === id) setSelected(null)
      toast('ליד נמחק', 'success')
    } catch { toast('שגיאה במחיקה', 'error') }
    finally { setDeleting(null) }
  }

  const exportCSV = () => {
    const headers = ['שם', 'מייל', 'טלפון', 'חברה', 'מקור', 'סטטוס', 'תאריך', 'הערות']
    const rows = filtered.map(l => [
      l.name || '', l.email || '', l.phone || '', l.company || '',
      l.source || '', STATUS_META[l.status].label,
      new Date(l.created_at).toLocaleDateString('he-IL'), l.notes || '',
    ])
    const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = 'leads.csv'; a.click()
  }

  const filtered = leads.filter(l => {
    if (filterStatus !== 'all' && l.status !== filterStatus) return false
    if (!search) return true
    const s = search.toLowerCase()
    return (l.name || '').toLowerCase().includes(s) ||
      (l.email || '').toLowerCase().includes(s) ||
      (l.company || '').toLowerCase().includes(s) ||
      (l.phone || '').toLowerCase().includes(s)
  })

  // KPI counts
  const counts = STATUSES.reduce((acc, s) => ({ ...acc, [s]: leads.filter(l => l.status === s).length }), {} as Record<Lead['status'], number>)
  const convRate = leads.length > 0 ? Math.round((counts.converted / leads.length) * 100) : 0

  const inputCls = "w-full bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2.5 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"

  return (
    <div className="p-6 max-w-7xl mx-auto" dir="rtl">

      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center shadow-lg">
            <Users className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">CRM לידים</h1>
            <p className="text-slate-400 text-sm">{leads.length} לידים סה"כ</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportCSV} className="flex items-center gap-1.5 text-slate-400 hover:text-white border border-white/10 px-3 py-2 rounded-xl text-sm transition-colors hover:bg-white/5">
            <Download className="w-4 h-4" /> ייצא CSV
          </button>
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 bg-gradient-to-l from-purple-600 to-indigo-600 text-white font-bold px-4 py-2 rounded-xl text-sm hover:opacity-90 transition-opacity">
            <Plus className="w-4 h-4" /> ליד חדש
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
        {STATUSES.map(s => (
          <button key={s}
            onClick={() => setFilterStatus(filterStatus === s ? 'all' : s)}
            className={`bg-slate-900/60 border rounded-2xl p-3 text-right transition-all hover:scale-[1.02] ${
              filterStatus === s ? STATUS_META[s].border + ' ' + STATUS_META[s].bg : 'border-white/10'
            }`}
          >
            <div className={`text-2xl font-bold ${STATUS_META[s].color}`}>{counts[s]}</div>
            <div className="text-slate-400 text-xs mt-0.5">{STATUS_META[s].label}</div>
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute top-2.5 right-3 w-4 h-4 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="חפש שם, מייל, טלפון..." className={inputCls.replace('w-full', 'w-full pr-9')} />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as Lead['status'] | 'all')}
          className="bg-slate-900/60 border border-white/10 rounded-xl px-3 py-2 text-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
          <option value="all">כל הסטטוסים</option>
          {STATUSES.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </select>
        {/* View toggle */}
        <div className="flex bg-slate-900/60 border border-white/10 rounded-xl overflow-hidden">
          {(['kanban', 'table'] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm transition-colors ${view === v ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-white'}`}>
              {v === 'kanban' ? <LayoutGrid className="w-4 h-4" /> : <List className="w-4 h-4" />}
              {v === 'kanban' ? 'לוח' : 'טבלה'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
        </div>
      ) : (
        <>
          {/* ── KANBAN ── */}
          {view === 'kanban' && (
            <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: 400 }}>
              {STATUSES.map(col => {
                const colLeads = filtered.filter(l => l.status === col)
                const meta = STATUS_META[col]
                return (
                  <div key={col} className="flex-shrink-0 w-60">
                    {/* Column header */}
                    <div className={`flex items-center gap-2 px-3 py-2 rounded-xl mb-2 ${meta.bg} ${meta.border} border`}>
                      <div className={`w-2 h-2 rounded-full ${meta.dot}`} />
                      <span className={`text-sm font-bold ${meta.color}`}>{meta.label}</span>
                      <span className="mr-auto text-xs text-slate-500 font-medium">{colLeads.length}</span>
                    </div>
                    {/* Cards */}
                    <div className="space-y-2">
                      {colLeads.length === 0 && (
                        <div className="border border-dashed border-white/10 rounded-xl p-4 text-center text-slate-600 text-xs">
                          אין לידים
                        </div>
                      )}
                      {colLeads.map(lead => (
                        <motion.div key={lead.id}
                          layout
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          onClick={() => setSelected(lead)}
                          className="bg-slate-900/70 border border-white/8 rounded-xl p-3 cursor-pointer hover:border-white/20 hover:bg-slate-800/70 transition-all group"
                        >
                          <div className="font-semibold text-white text-sm mb-1 truncate">{lead.name || '—'}</div>
                          {lead.email && <div className="flex items-center gap-1 text-slate-500 text-xs mb-0.5"><Mail className="w-3 h-3 flex-shrink-0" /><span className="truncate">{lead.email}</span></div>}
                          {lead.phone && <div className="flex items-center gap-1 text-slate-500 text-xs mb-0.5"><Phone className="w-3 h-3 flex-shrink-0" />{lead.phone}</div>}
                          {lead.company && <div className="flex items-center gap-1 text-slate-500 text-xs"><Building2 className="w-3 h-3 flex-shrink-0" /><span className="truncate">{lead.company}</span></div>}
                          <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/5">
                            <span className="text-slate-600 text-[10px]">{new Date(lead.created_at).toLocaleDateString('he-IL')}</span>
                            <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={e => { e.stopPropagation(); moveStatus(lead, 1) }}
                                disabled={STATUSES.indexOf(lead.status) === STATUSES.length - 1 || movingId === lead.id}
                                className="p-1 text-slate-400 hover:text-white rounded disabled:opacity-20" title="הרד שלב">
                                <ChevronLeft className="w-3 h-3" />
                              </button>
                              <button onClick={e => { e.stopPropagation(); moveStatus(lead, -1) }}
                                disabled={STATUSES.indexOf(lead.status) === 0 || movingId === lead.id}
                                className="p-1 text-slate-400 hover:text-white rounded disabled:opacity-20" title="קדם שלב">
                                <ChevronRight className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* ── TABLE ── */}
          {view === 'table' && (
            filtered.length === 0 ? (
              <div className="text-center py-16">
                <Users className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                <p className="text-slate-500 text-sm">אין לידים להצגה</p>
              </div>
            ) : (
              <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-slate-400 text-xs">
                        <th className="text-right px-4 py-3 font-semibold">שם</th>
                        <th className="text-right px-4 py-3 font-semibold">פרטי קשר</th>
                        <th className="text-right px-4 py-3 font-semibold">חברה</th>
                        <th className="text-right px-4 py-3 font-semibold">מקור</th>
                        <th className="text-right px-4 py-3 font-semibold">סטטוס</th>
                        <th className="text-right px-4 py-3 font-semibold">תאריך</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(lead => {
                        const meta = STATUS_META[lead.status]
                        return (
                          <tr key={lead.id}
                            onClick={() => setSelected(lead)}
                            className="border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer">
                            <td className="px-4 py-3"><span className="text-white font-medium">{lead.name || '—'}</span></td>
                            <td className="px-4 py-3">
                              <div className="space-y-0.5">
                                {lead.email && <div className="flex items-center gap-1.5 text-slate-400 text-xs"><Mail className="w-3 h-3" />{lead.email}</div>}
                                {lead.phone && <div className="flex items-center gap-1.5 text-slate-400 text-xs"><Phone className="w-3 h-3" />{lead.phone}</div>}
                              </div>
                            </td>
                            <td className="px-4 py-3">{lead.company && <span className="text-slate-400 text-xs">{lead.company}</span>}</td>
                            <td className="px-4 py-3"><span className="text-slate-400 text-xs">{lead.source || '—'}</span></td>
                            <td className="px-4 py-3">
                              <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${meta.bg} ${meta.color} border ${meta.border}`}>
                                {meta.label}
                              </span>
                            </td>
                            <td className="px-4 py-3"><span className="text-slate-500 text-xs">{new Date(lead.created_at).toLocaleDateString('he-IL')}</span></td>
                            <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                              <button onClick={() => deleteLead(lead.id)} disabled={deleting === lead.id}
                                className="p-1.5 text-slate-500 hover:text-red-400 transition-colors rounded-lg hover:bg-white/5 disabled:opacity-40">
                                {deleting === lead.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          )}
        </>
      )}

      {/* ── LEAD DETAIL PANEL ── */}
      <AnimatePresence>
        {selected && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setSelected(null)}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" />
            <motion.div
              initial={{ x: -400, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -400, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="fixed right-0 top-0 h-full w-80 bg-slate-900 border-l border-white/10 z-50 flex flex-col shadow-2xl"
              dir="rtl"
            >
              {/* Panel header */}
              <div className="flex items-center justify-between p-5 border-b border-white/10">
                <div>
                  <h2 className="text-white font-bold text-lg">{selected.name || 'ליד ללא שם'}</h2>
                  {selected.company && <p className="text-slate-400 text-xs mt-0.5">{selected.company}</p>}
                </div>
                <button onClick={() => setSelected(null)} className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-white/10 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-5">
                {/* Contact info */}
                <div className="space-y-2">
                  <p className="text-slate-500 text-xs font-semibold uppercase tracking-wide">פרטי קשר</p>
                  {selected.email && (
                    <a href={`mailto:${selected.email}`} className="flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-800/50 hover:bg-slate-800 transition-colors group">
                      <Mail className="w-4 h-4 text-blue-400 flex-shrink-0" />
                      <span className="text-slate-300 text-sm truncate group-hover:text-white">{selected.email}</span>
                    </a>
                  )}
                  {selected.phone && (
                    <a href={`tel:${selected.phone}`} className="flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-800/50 hover:bg-slate-800 transition-colors group">
                      <Phone className="w-4 h-4 text-green-400 flex-shrink-0" />
                      <span className="text-slate-300 text-sm group-hover:text-white">{selected.phone}</span>
                    </a>
                  )}
                  {selected.source && (
                    <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-800/50">
                      <Tag className="w-4 h-4 text-purple-400 flex-shrink-0" />
                      <span className="text-slate-400 text-sm">{selected.source}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-800/50">
                    <Calendar className="w-4 h-4 text-slate-500 flex-shrink-0" />
                    <span className="text-slate-400 text-sm">{new Date(selected.created_at).toLocaleDateString('he-IL', { day: '2-digit', month: 'long', year: 'numeric' })}</span>
                  </div>
                </div>

                {/* Status */}
                <div>
                  <p className="text-slate-500 text-xs font-semibold uppercase tracking-wide mb-2">סטטוס</p>
                  <div className="grid grid-cols-1 gap-1.5">
                    {STATUSES.map(s => {
                      const meta = STATUS_META[s]
                      const active = selected.status === s
                      return (
                        <button key={s} onClick={() => changeStatus(selected, s)}
                          disabled={movingId === selected.id}
                          className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition-all text-right ${
                            active ? `${meta.bg} ${meta.border} ${meta.color}` : 'border-white/5 text-slate-500 hover:border-white/15 hover:text-slate-300'
                          }`}>
                          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${active ? meta.dot : 'bg-slate-600'}`} />
                          {meta.label}
                          {active && <span className="mr-auto text-[10px] opacity-60">נוכחי</span>}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <p className="text-slate-500 text-xs font-semibold uppercase tracking-wide mb-2 flex items-center gap-1.5">
                    <StickyNote className="w-3.5 h-3.5" /> הערות
                  </p>
                  <textarea
                    value={editNotes}
                    onChange={e => setEditNotes(e.target.value)}
                    placeholder="הוסף הערה על הליד..."
                    rows={4}
                    className="w-full bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2.5 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
                  />
                  <button onClick={saveNotes} disabled={savingNotes || editNotes === (selected.notes || '')}
                    className="mt-2 w-full flex items-center justify-center gap-2 bg-purple-600/80 hover:bg-purple-600 text-white text-sm font-medium py-2 rounded-xl transition-colors disabled:opacity-40">
                    {savingNotes ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageSquare className="w-3.5 h-3.5" />}
                    שמור הערות
                  </button>
                </div>
              </div>

              {/* Panel footer */}
              <div className="p-4 border-t border-white/10">
                <button onClick={() => deleteLead(selected.id)} disabled={deleting === selected.id}
                  className="w-full flex items-center justify-center gap-2 text-red-400 hover:text-red-300 border border-red-500/20 hover:border-red-500/40 py-2 rounded-xl text-sm transition-all hover:bg-red-500/10 disabled:opacity-40">
                  {deleting === selected.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  מחק ליד
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── ADD LEAD MODAL ── */}
      <AnimatePresence>
        {showAdd && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowAdd(false)} className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed inset-0 flex items-center justify-center z-50 p-4"
            >
              <div className="bg-slate-900 border border-white/15 rounded-3xl p-6 w-full max-w-md shadow-2xl" dir="rtl">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-white font-bold text-lg">הוסף ליד חדש</h2>
                  <button onClick={() => setShowAdd(false)} className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-white/10 transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="space-y-3">
                  {([
                    { key: 'name',    label: 'שם מלא',    placeholder: 'ישראל ישראלי', type: 'text' },
                    { key: 'email',   label: 'מייל',       placeholder: 'israel@example.com', type: 'email' },
                    { key: 'phone',   label: 'טלפון',      placeholder: '05X-XXXXXXX', type: 'tel' },
                    { key: 'company', label: 'חברה',       placeholder: 'שם החברה', type: 'text' },
                    { key: 'source',  label: 'מקור',       placeholder: 'פייסבוק, גוגל...', type: 'text' },
                  ] as const).map(({ key, label, placeholder, type }) => (
                    <div key={key}>
                      <label className="block text-slate-400 text-xs mb-1">{label}</label>
                      <input type={type} value={addForm[key]}
                        onChange={e => setAddForm(p => ({ ...p, [key]: e.target.value }))}
                        placeholder={placeholder} className={inputCls} />
                    </div>
                  ))}
                  <div>
                    <label className="block text-slate-400 text-xs mb-1">סטטוס</label>
                    <select value={addForm.status} onChange={e => setAddForm(p => ({ ...p, status: e.target.value as Lead['status'] }))}
                      className={inputCls}>
                      {STATUSES.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-400 text-xs mb-1">הערות</label>
                    <textarea value={addForm.notes} onChange={e => setAddForm(p => ({ ...p, notes: e.target.value }))}
                      placeholder="הערות ראשוניות..." rows={2} className={inputCls + ' resize-none'} />
                  </div>
                </div>
                <div className="flex gap-2 mt-5">
                  <button onClick={() => setShowAdd(false)} className="flex-1 border border-white/10 text-slate-400 hover:text-white py-2.5 rounded-xl text-sm transition-colors hover:bg-white/5">
                    ביטול
                  </button>
                  <button onClick={addLead} disabled={saving}
                    className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-l from-purple-600 to-indigo-600 text-white font-bold py-2.5 rounded-xl text-sm hover:opacity-90 transition-opacity disabled:opacity-50">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    הוסף ליד
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
