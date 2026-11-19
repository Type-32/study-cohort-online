import { z } from 'zod'

export const usernameSchema = z.string().trim().min(1, 'Pick a display name.').max(32, 'Keep it under 32 characters.')
