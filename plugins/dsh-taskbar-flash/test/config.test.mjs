import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_CONFIG, resolveConfig } from '../lib/config.js'

test('defaults when config is absent', () => {
  const { config, notes } = resolveConfig(undefined)
  assert.deepEqual(config, DEFAULT_CONFIG)
  assert.deepEqual(notes, [])
})

test('accepts every documented key', () => {
  const { config, notes } = resolveConfig({
    enabled: false,
    ignoreSubagents: false,
    onlyWhenUnfocused: false,
    flashCount: 3,
    cooldownMs: 0,
    processName: 'Other Name',
    powerShellCommand: 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',
    log: false,
  })
  assert.deepEqual(notes, [])
  assert.equal(config.enabled, false)
  assert.equal(config.flashCount, 3)
  assert.equal(config.cooldownMs, 0)
})

test('bad values fall back with one note each', () => {
  const { config, notes } = resolveConfig({
    enabled: 'yes',
    flashCount: -1,
    cooldownMs: 1.5,
    processName: '   ',
    log: 1,
  })
  assert.equal(config.enabled, DEFAULT_CONFIG.enabled)
  assert.equal(config.flashCount, DEFAULT_CONFIG.flashCount)
  assert.equal(config.cooldownMs, DEFAULT_CONFIG.cooldownMs)
  assert.equal(config.processName, DEFAULT_CONFIG.processName)
  assert.equal(config.log, DEFAULT_CONFIG.log)
  assert.equal(notes.length, 5)
})

test('unknown keys are reported once and ignored', () => {
  const { notes } = resolveConfig({ flshCount: 3 })
  assert.equal(notes.length, 1)
  assert.match(notes[0], /flshCount/)
})
