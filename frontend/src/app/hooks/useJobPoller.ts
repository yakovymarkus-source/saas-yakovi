import { useEffect, useRef } from 'react'
import { sb } from '../api/client'

interface JobResult {
  status: string
  result_payload?: unknown
}

export function useJobPoller(
  jobId: string | null,
  onDone: (payload: unknown) => void,
  onFailed: () => void,
) {
  const attemptsRef = useRef(0)

  useEffect(() => {
    if (!jobId) return
    attemptsRef.current = 0

    const poll = async () => {
      attemptsRef.current++
      try {
        const { data } = await sb
          .from('sync_jobs')
          .select('status,result_payload')
          .eq('id', jobId)
          .maybeSingle()

        const job = data as JobResult | null
        if (job?.status === 'done') { onDone(job.result_payload); return }
        if (job?.status === 'failed') { onFailed(); return }
        if (attemptsRef.current < 40) setTimeout(poll, 3000)
        else onFailed()
      } catch {
        if (attemptsRef.current < 40) setTimeout(poll, 3000)
        else onFailed()
      }
    }

    const t = setTimeout(poll, 3000)
    return () => clearTimeout(t)
  }, [jobId, onDone, onFailed])
}
