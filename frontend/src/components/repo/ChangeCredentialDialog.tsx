import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { updateRepoCredential } from '@/api/repos'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Loader2, Key } from 'lucide-react'
import { useSettings } from '@/hooks/useSettings'
import { showToast } from '@/lib/toast'

interface ChangeCredentialDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  repoId: number
  currentCredentialName?: string | null
}

export function ChangeCredentialDialog({ 
  open, 
  onOpenChange, 
  repoId,
  currentCredentialName 
}: ChangeCredentialDialogProps) {
  const [selectedCredential, setSelectedCredential] = useState(currentCredentialName || '')
  const queryClient = useQueryClient()
  const { preferences } = useSettings()
  const gitCredentials = preferences?.gitCredentials || []

  const mutation = useMutation({
    mutationFn: (credentialName: string | null) => updateRepoCredential(repoId, credentialName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repo', repoId] })
      queryClient.invalidateQueries({ queryKey: ['repos'] })
      showToast.success('Credential updated successfully')
      onOpenChange(false)
    },
    onError: (error: Error) => {
      showToast.error(error.message || 'Failed to update credential')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    mutation.mutate(selectedCredential || null)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px] bg-[#141414] border-[#2a2a2a]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
            <Key className="w-5 h-5" />
            Change Git Credential
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
            Select which credential to use for git operations. The credential will be embedded in the remote URL for reliable authentication.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          {gitCredentials.length > 0 ? (
            <div className="space-y-2">
              <label className="text-sm text-zinc-400">Git Credential</label>
              <select
                value={selectedCredential}
                onChange={(e) => setSelectedCredential(e.target.value)}
                disabled={mutation.isPending}
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] text-white rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="">Use askpass handler (no embedded credential)</option>
                {gitCredentials.map((cred) => (
                  <option key={cred.name} value={cred.name}>
                    {cred.name} ({cred.host})
                  </option>
                ))}
              </select>
              {currentCredentialName && (
                <p className="text-xs text-zinc-500">
                  Current: {currentCredentialName}
                </p>
              )}
            </div>
          ) : (
            <div className="p-4 border border-[#2a2a2a] rounded-md bg-[#1a1a1a]">
              <p className="text-sm text-zinc-400">
                No git credentials configured. Add credentials in Settings to use this feature.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
              className="bg-[#1a1a1a] border-[#2a2a2a] text-white hover:bg-[#2a2a2a]"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={mutation.isPending || gitCredentials.length === 0}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Updating...
                </>
              ) : (
                'Update Credential'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
