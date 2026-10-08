import { contextBridge } from 'electron'

// Replaced by the full typed bridge in the auth/API milestone.
contextBridge.exposeInMainWorld('nexus', { ready: true })
