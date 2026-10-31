// The engine lives in @sagyou/core (shared with the phone). What stays here is
// what touches this machine's disk: the remote-wipe file list and the config name.
export * from '@sagyou/core/sync/engine'
export { wipeLocalData, wipeTargets } from './wipe'
export { syncConfigFileName } from './sync-config'
