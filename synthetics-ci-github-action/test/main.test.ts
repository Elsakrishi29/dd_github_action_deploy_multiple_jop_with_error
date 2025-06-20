import * as core from '@actions/core'
import {synthetics} from '@datadog/datadog-ci'
import {expect, test} from '@jest/globals'

import {execFile} from 'child_process'
import * as path from 'path'

import {config, EMPTY_SUMMARY} from '../src/fixtures'
import run from '../src/main'
import * as fs from 'fs'

const inputs = {
  apiKey: 'xxx',
  appKey: 'yyy',
  publicIds: ['public_id1'],
}

describe('Run Github Action', () => {
  beforeEach(() => {
    jest.restoreAllMocks()

    process.env = {
      ...process.env,
      'INPUT_API-KEY': inputs.apiKey,
      'INPUT_APP-KEY': inputs.appKey,
      'INPUT_PUBLIC-IDS': inputs.publicIds.join(', '),
    }

    jest.spyOn(process.stdout, 'write').mockImplementation()
    jest.spyOn(core, 'setFailed').mockImplementation()
    jest.spyOn(synthetics.utils, 'getOrgSettings').mockImplementation()
  })

  describe('Handle input parameters', () => {
    afterEach(() => {
      // Cleaning
      try {
        if (fs.existsSync('./reports/TEST-1.xml')) {
          fs.unlinkSync('./reports/TEST-1.xml')
        }
        if (fs.existsSync('./reports')) {
          fs.rmdirSync('./reports')
        }
      } catch (error) {
        // Ignore errors during cleanup
      }
    })

    test('Github Action called with dummy parameter fails with core.setFailed', async () => {
      process.env = {
        ...process.env,
        'INPUT_FAIL-ON-CRITICAL-ERRORS': 'true',
      }

      const setFailedMock = jest.spyOn(core, 'setFailed')

      await run()

      delete process.env['INPUT_FAIL-ON-CRITICAL-ERRORS']

      expect(setFailedMock).toHaveBeenCalledWith('Running Datadog Synthetics tests failed.')
    })

    test('Github Action core.getInput parameters are passed on to runTests', async () => {
      jest.spyOn(synthetics, 'executeTests').mockImplementation()

      await run()
      expect(synthetics.executeTests).toHaveBeenCalledWith(expect.anything(), {
        ...config,
        ...inputs,
      })
    })

    test('Github Action parses out publicIds string', async () => {
      const publicIds = ['public_id1', 'public_id2', 'public_id3']
      process.env = {
        ...process.env,
        'INPUT_PUBLIC-IDS': publicIds.join(', '),
      }
      jest.spyOn(synthetics, 'executeTests').mockImplementation()

      await run()
      expect(synthetics.executeTests).toHaveBeenCalledWith(expect.anything(), {
        ...config,
        ...inputs,
        publicIds,
      })
    })

    test('Github Action parses out variables string', async () => {
      process.env = {
        ...process.env,
        INPUT_VARIABLES: 'START_URL=https://example.org,MY_VARIABLE=My title',
      }

      jest.spyOn(synthetics, 'executeTests').mockImplementation()

      await run()
      expect(synthetics.executeTests).toHaveBeenCalledWith(expect.anything(), {
        ...config,
        ...inputs,
        defaultTestOverrides: {
          ...config.defaultTestOverrides,
          variables: {
            START_URL: 'https://example.org',
            MY_VARIABLE: 'My title',
          },
        },
      })

      delete process.env['INPUT_VARIABLES']
    })

    test('Github Action generates a jUnit report', async () => {
      process.env = {
        ...process.env,
        'INPUT_JUNIT-REPORT': 'reports/TEST-1.xml',
      }

      jest.spyOn(synthetics, 'executeTests').mockResolvedValue({
        results: [],
        summary: EMPTY_SUMMARY,
      })

      await run()
      expect(synthetics.executeTests).toHaveBeenCalledWith(expect.anything(), {
        ...config,
        ...inputs,
      })

      expect(fs.existsSync('./reports/TEST-1.xml')).toBe(true)

      delete process.env['INPUT_JUNIT-REPORT']
    })
  })

  describe('Handle invalid input parameters', () => {
    test('Use default configuration if Github Action input is not set', async () => {
      jest.spyOn(synthetics, 'executeTests').mockImplementation()
      await run()
      expect(synthetics.executeTests).toHaveBeenCalledWith(expect.anything(), {
        ...config,
        ...inputs,
        datadogSite: 'datadoghq.com',
      })
    })
  })

  describe('Handle configuration file', () => {
    test('Github Action fails if unable to parse config file', async () => {
      const setFailedMock = jest.spyOn(core, 'setFailed')
      process.env = {
        ...process.env,
        'INPUT_CONFIG-PATH': 'foo',
      }
      await expect(run()).rejects.toThrow('Config file not found')
      expect(setFailedMock).toHaveBeenCalled()
      process.env = {}
    })
  })

  describe('Handle Synthetics test results', () => {
    beforeEach(() => {
      // renderResults() does side effects on the summary: mocking it for easier testing.
      jest.spyOn(synthetics.utils, 'renderResults').mockImplementation()
    })

    test('Github Action fails if Synthetics tests fail', async () => {
      const setFailedMock = jest.spyOn(core, 'setFailed')

      jest.spyOn(synthetics, 'executeTests').mockResolvedValue({
        results: [{passed: false, test: {public_id: 'aaa-bbb-ccc'}, result: {}} as synthetics.Result],
        summary: {...EMPTY_SUMMARY, failed: 1},
      })

      await run()
      expect(setFailedMock).toHaveBeenCalledWith(
        `Datadog Synthetics tests failed: criticalErrors: 0, passed: 0, previouslyPassed: 0, failedNonBlocking: 0, failed: 1, skipped: 0, notFound: 0, timedOut: 0\n` +
          `Batch URL: https://app.datadoghq.com/synthetics/explorer/ci?batchResultId=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`
      )
    })

    test('Github Action fails if Synthetics tests timed out and config.failOnTimeout = true', async () => {
      const setFailedMock = jest.spyOn(core, 'setFailed')

      jest.spyOn(synthetics, 'executeTests').mockResolvedValue({
        // `config.failOnTimeout = true` makes `passed` be false.
        results: [{passed: false, timedOut: true, test: {public_id: 'aaa-bbb-ccc'}, result: {}} as synthetics.Result],
        summary: {...EMPTY_SUMMARY, timedOut: 1},
      })

      await run()
      expect(setFailedMock).toHaveBeenCalledWith(
        `Datadog Synthetics tests failed: criticalErrors: 0, passed: 0, previouslyPassed: 0, failedNonBlocking: 0, failed: 0, skipped: 0, notFound: 0, timedOut: 1\n` +
          `Batch URL: https://app.datadoghq.com/synthetics/explorer/ci?batchResultId=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`
      )
    })

    test('Github Action succeeds if Synthetics tests timed out and config.failOnTimeout = false', async () => {
      const setFailedMock = jest.spyOn(core, 'setFailed')
      const infoMock = jest.spyOn(core, 'info')

      jest.spyOn(synthetics, 'executeTests').mockResolvedValue({
        // `config.failOnTimeout = false` makes `passed` be true.
        results: [{passed: true, timedOut: true, test: {public_id: 'aaa-bbb-ccc'}, result: {}} as synthetics.Result],
        summary: {...EMPTY_SUMMARY, timedOut: 1},
      })

      await run()
      expect(setFailedMock).not.toHaveBeenCalled()
      expect(infoMock).toHaveBeenCalledWith(
        `Datadog Synthetics tests succeeded add new one: criticalErrors: 0, passed: 0, previouslyPassed: 0, failedNonBlocking: 0, failed: 0, skipped: 0, notFound: 0, timedOut: 1\n` +
          `Batch URL: https://app.datadoghq.com/synthetics/explorer/ci?batchResultId=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`
      )
    })

    // Extra Code Added start

    // test('Github Action succeeds if Synthetics tests timed out and config.failOnTimeout = false', async () => {
    //   const setFailedMock = jest.spyOn(core, 'setFailed')
    //   const infoMock = jest.spyOn(core, 'info')

    //   jest.spyOn(synthetics, 'executeTests').mockResolvedValue({
    //     results: [{passed: true, timedOut: true, test: {public_id: 'aaa-bbb-ccc'}, result: {}} as synthetics.Result],
    //     summary: {...EMPTY_SUMMARY, timedOut: 1},
    //   })

    //   await run()
    //   expect(setFailedMock).not.toHaveBeenCalled()

    //   const expected = `Datadog Synthetics tests succeeded: criticalErrors: 0, passed: 0, previouslyPassed: 0, failedNonBlocking: 0, failed: 0, skipped: 0, notFound: 0, timedOut: 1`
    //   const allInfoCalls = infoMock.mock.calls.map((call) => call[0])
    //   console.log('infoMock calls:', allInfoCalls)
    //   const matchingCall = allInfoCalls.find((msg) => msg.includes(expected))
    //   expect(matchingCall).toBeDefined()
    // })

    // Extra Code Added End

    test('Github Action succeeds if Synthetics tests not found with failOnMissingTests = false', async () => {
      const infoMock  = jest.spyOn(core, 'info')

      jest.spyOn(synthetics, 'executeTests').mockResolvedValue({
        results: [],
        summary: {...EMPTY_SUMMARY, testsNotFound: new Set(['unk-now-nid'])},
      })

      await run()
      expect(infoMock).toHaveBeenCalledWith(
        `Datadog Synthetics tests succeeded add new one: criticalErrors: 0, passed: 0, previouslyPassed: 0, failedNonBlocking: 0, failed: 0, skipped: 0, notFound: 1, timedOut: 0\n` +
          `Batch URL: https://app.datadoghq.com/synthetics/explorer/ci?batchResultId=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`
      )
    })

    // Extra Code Added start

    // test('Github Action succeeds if Synthetics tests not found with failOnMissingTests = false', async () => {
    //   const infoMock = jest.spyOn(core, 'info')

    //   jest.spyOn(synthetics, 'executeTests').mockResolvedValue({
    //     results: [],
    //     summary: {...EMPTY_SUMMARY, testsNotFound: new Set(['unk-now-nid'])},
    //   })

    //   await run()

    //   const expected = `Datadog Synthetics tests succeeded: criticalErrors: 0, passed: 0, previouslyPassed: 0, failedNonBlocking: 0, failed: 0, skipped: 0, notFound: 1, timedOut: 0`
    //   const allInfoCalls = infoMock.mock.calls.map((call) => call[0])
    //   const matchingCall = allInfoCalls.find((msg) => msg.includes(expected))
    //   expect(matchingCall).toBeDefined()
    // })

    // Extra Code Added End

    test('Github Action succeeds if Synthetics tests do not fail', async () => {
      const setFailedMock = jest.spyOn(core, 'setFailed')

      jest.spyOn(synthetics, 'executeTests').mockResolvedValue({
        results: [],
        summary: {...EMPTY_SUMMARY, passed: 1},
      })

      await run()
      expect(setFailedMock).not.toHaveBeenCalled()
    })
  })

  describe('Github Action execution', () => {
    test('Github Action runs from js file', async () => {
      const nodePath = process.execPath
      const scriptPath = path.join(__dirname, '..', 'lib', 'main.js')
      try {
        await new Promise<string>((resolve, reject) =>
          execFile(nodePath, [scriptPath], (error, stdout) => (error ? reject(error) : resolve(stdout.toString())))
        )
      } catch (error) {
        expect((error as NodeJS.ErrnoException).code).toBe(1)
      }
    })
  })
})
