import { useState, useEffect } from 'react'
import { motion } from 'motion/react'
import {
  Users, Search, Download, Trash2, Edit3, ChevronDown,
  ChevronUp, Loader2, Plus, Mail, Phone, Building2, Calendar,
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

const STATUS_LABELS: Record<Lead['status'], string> = {
  new: 'חדש', contacted: 'נוצר קשר', qualified: 'מוסמך', converted: 'הפך ללקוח', lost: 'אבד',
}
const STATUS_COLORS: Record<Lead['status'], string> = {
  new: 'bg-blue-500/20 text-blue-400',
  contacted: 'bg-yellow-500/20 text-yellow-400',
  qualified: 'bg-purple-500/20 text-purple-400',
  converted: 'bg-green-500/20 text-green-400',
  lost: 'bg-red-500/20 text-red-400',
}

type SortKey = 'name' | 'created_at' | 'status'

export function Leads() {
  const { state } = useAppState()
  const toast = useToast()
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<Lead['status'] | 'all'>('all')
  const [sortKey, setSortKey] = useState<SortKey>('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editStatus, setEditStatus] = useState<Lead['status']>('new')

  useEffect(() => {
    if (!state.user) return
    loadLeads()
  }, [state.user])

  const loadLeads = async () => {
    setLoading(true)
    try {
      const { data, error } = await sb
        .from('leads')
        .select('*')
        .eq('user_id', state.user!.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      setLeads((data || []) as Lead[])
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'שגיאה בטעינת לידים'
      toast(msg, 'error')
    } finally {
      setLoading(false)
    }
  }

  const deleteLead = async (id: string) => {
    if (!confirm('למחוק ליד זה?')) return
    setDeleting(id)
    try {
      const { error } = await sb.from('leads').delete().eq('id', id)
      if (error) throw error
      setLeads(prev => prev.filter(l => l.id !== id))
      toast('ליד נמחק', 'success')
    } catch (err: unknown) {
      toast('שגיאה במחיקה', 'error')
    } finally {
      setDeleting(null)
    }
  }

  const updateStatus = async (id: string) => {
    try {
      const { error } = await sb.from('leads').update({ status: editStatus }).eq('id', id)
      if (error) throw error
      setLeads(prev => prev.map(l => l.id === id ? { ...l, status: editStatus } : l))
      setEditingId(null)
      toast('סטטוס עודכן', 'success')
    } catch {
      toast('שגיאה בעדכון', 'error')
    }
  }

  const exportCSV = () => {
    const headers = ['שם', 'מייל', 'טלפון', 'חברה', 'מקור', 'סטטוס', 'תאריך']
    const rows = filtered.map(l => [
      l.name || '', l.email || '', l.phone || '', l.company || '',
      l.source || '', STATUS_LABELS[l.status], new Date(l.created_at).toLocaleDateString('he-IL'),
    ])
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'leads.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const filtered = leads
    .filter(l => {
      if (filterStatus !== 'all' && l.status !== filterStatus) return false
      if (!search) return true
      const s = search.toLowerCase()
      return (l.name || '').toLowerCase().includes(s)
        || (l.email || '').toLowerCase().includes(s)
        || (l.company || '').toLowerCase().includes(s)
    })
    .sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1
      if (sortKey === 'name') return (a.name || '').localeCompare(b.name || '') * dir
      if (sortKey === 'status') return a.status.localeCompare(b.status) * dir
      return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir
    })

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey === k
      ? sortDir === 'asc' ? <ChevronUp className="w-3.5 h-3.5 inline" /> : <ChevronDown className="w-3.5 h-3.5 inline" />
      : <ChevronDown className="w-3.5 h-3.5 inline opacity-30" />

  return (
    <div className="p-6 max-w-6xl mx-auto" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center shadow-lg">
            <Users className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">לידים</h1>
            <p className="text-slate-400 text-sm">{leads.length} לידים במסד</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportCSV}
            className="flex items-center gap-2 text-slate-400 hover:text-white border border-white/10 px-3 py-2 rounded-xl text-sm transition-colors hover:bg-white/5"
          >
            <Download className="w-4 h-4" />
            ייצא CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute top-2.5 right-3 w-4 h-4 text-slate-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="חפש ליד..."
            className="w-full bg-slate-900/60 border border-white/10 rounded-xl pr-9 px-3 py-2 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value as Lead['status'] | 'all')}
          className="bg-slate-900/60 border border-white/10 rounded-xl px-3 py-2 text-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
        >
          <option value="all">כל הסטטוסים</option>
          {(Object.entries(STATUS_LABELS) as [Lead['status'], string][]).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 rounded-3xl bg-slate-800/60 border border-white/10 flex items-center justify-center mx-auto mb-4">
            <Users className="w-8 h-8 text-slate-600" />
          </div>
          <p className="text-slate-500 text-sm">אין לידים להצגה</p>
          <p className="text-slate-600 text-xs mt-1">לידים יופיעו כאן לאחר קמפיינים ראשונים</p>
        </div>
      ) : (
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-slate-400 text-xs">
                  <th className="text-right px-4 py-3 font-semibold cursor-pointer hover:text-white" onClick={() => toggleSort('name')}>
                    שם <SortIcon k="name" />
                  </th>
                  <th className="text-right px-4 py-3 font-semibold">פרטי קשר</th>
                  <th className="text-right px-4 py-3 font-semibold">חברה</th>
                  <th className="text-right px-4 py-3 font-semibold">מקור</th>
                  <th className="text-right px-4 py-3 font-semibold cursor-pointer hover:text-white" onClick={() => toggleSort('status')}>
                    סטטוס <SortIcon k="status" />
                  </th>
                  <th className="text-right px-4 py-3 font-semibold cursor-pointer hover:text-white" onClick={() => toggleSort('created_at')}>
                    תאריך <SortIcon k="created_at" />
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map(lead => (
                  <motion.tr
                    key={lead.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="border-b border-white/5 hover:bg-white/5 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <span className="text-white font-medium">{lead.name || '—'}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="space-y-0.5">
                        {lead.email && (
                          <div className="flex items-center gap-1.5 text-slate-400">
                            <Mail className="w-3 h-3" />
                            <span className="text-xs">{lead.email}</span>
                          </div>
                        )}
                        {lead.phone && (
                          <div className="flex items-center gap-1.5 text-slate-400">
                            <Phone className="w-3 h-3" />
                            <span className="text-xs">{lead.phone}</span>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {lead.company && (
                        <div className="flex items-center gap-1.5 text-slate-400">
                          <Building2 className="w-3.5 h-3.5" />
                          <span className="text-xs">{lead.company}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-slate-400 text-xs">{lead.source || '—'}</span>
                    </td>
                    <td className="px-4 py-3">
                      {editingId === lead.id ? (
                        <div className="flex items-center gap-1">
                          <select
                            value={editStatus}
                            onChange={e => setEditStatus(e.target.value as Lead['status'])}
                            className="bg-slate-800 border border-white/10 rounded-lg px-2 py-1 text-white text-xs"
                          >
                            {(Object.entries(STATUS_LABELS) as [Lead['status'], string][]).map(([k, v]) => (
                              <option key={k} value={k}>{v}</option>
                            ))}
                          </select>
                          <button onClick={() => updateStatus(lead.id)} className="text-green-400 text-xs hover:text-green-300">✓</button>
                          <button onClick={() => setEditingId(null)} className="text-red-400 text-xs hover:text-red-300">✗</button>
                        </div>
                      ) : (
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COLORS[lead.status]}`}>
                          {STATUS_LABELS[lead.status]}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-slate-500">
                        <Calendar className="w-3.5 h-3.5" />
                        <span className="text-xs">{new Date(lead.created_at).toLocaleDateString('he-IL')}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => { setEditingId(lead.id); setEditStatus(lead.status) }}
                          className="p-1.5 text-slate-500 hover:text-blue-400 transition-colors rounded-lg hover:bg-white/5"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => deleteLead(lead.id)}
                          disabled={deleting === lead.id}
                          className="p-1.5 text-slate-500 hover:text-red-400 transition-colors rounded-lg hover:bg-white/5 disabled:opacity-40"
                        >
                          {deleting === lead.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
