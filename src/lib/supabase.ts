import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
)

export function publicImageUrl(bucket: string, path: string | null) {
  if (!path) return null
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl
}

export function thumbnailPath(path: string) {
  const extensionIndex = path.lastIndexOf('.')
  return `${extensionIndex > path.lastIndexOf('/') ? path.slice(0, extensionIndex) : path}.thumb.webp`
}

export function publicThumbnailUrl(bucket: string, path: string | null) {
  return path ? publicImageUrl(bucket, thumbnailPath(path)) : null
}

export async function signedReceiptUrl(path: string) {
  const { data, error } = await supabase.storage.from('payment-receipts').createSignedUrl(path, 300)
  if (error) throw error
  return data.signedUrl
}
