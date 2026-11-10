import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Services.UPower
import qs.Commons
import qs.Commons as Commons

// Headless logger: one battery reading a minute through bin/battery-insights,
// so the charts have history whether or not the panel was ever opened. The
// shell loads it while the widget is enabled. At start it also checks whether
// Omarchy has changed the power panel Widget.qml was copied from.
Item {
  id: root

  property var shell: null

  readonly property string helper: decodeURIComponent(Qt.resolvedUrl("bin/battery-insights").toString().replace(/^file:\/\//, ""))
  // The first run also imports UPower's recent history into the log.
  property bool backfilled: false
  property bool pending: false

  signal sampled()

  function sampleNow() {
    if (sampleProc.running) {
      pending = true
      return
    }
    sampleProc.command = ["bash", helper, "sample"].concat(backfilled ? [] : ["--backfill"])
    sampleProc.running = true
  }

  Process {
    id: sampleProc
    stderr: StdioCollector {
      waitForEnd: true
      onStreamFinished: if (text.trim()) console.warn("battery-insights: " + text.trim())
    }
    onExited: function(exitCode) {
      if (exitCode === 0) {
        root.backfilled = true
        root.sampled()
      } else if (exitCode === 2) {
        // No system battery (a desktop): nothing to log, stop asking.
        sampleTimer.running = false
        root.pending = false
        return
      }
      if (root.pending) {
        root.pending = false
        root.sampleNow()
      }
    }
  }

  Timer {
    id: sampleTimer
    interval: 60000
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: root.sampleNow()
  }

  // Plugging in or out gets its own reading so the charts show the switch
  // at the moment it happened, not up to a minute later.
  Connections {
    target: UPower
    function onOnBatteryChanged() { root.sampleNow() }
  }

  Commons.Translations { id: strings; directory: Qt.resolvedUrl("i18n") }

  // Widget.qml is a copy of Omarchy's power panel; when Omarchy ships a new
  // version the copy may be stale. The helper answers notify=1 with the stock
  // version's fingerprint until that version is marked announced, which
  // happens only after the notification really went out: a send that fails
  // (the notification daemon not up yet at shell start) is retried at the next
  // start, and restarts after a successful one stay quiet.
  property string stockFingerprint: ""

  Process {
    id: stockProc
    command: ["bash", root.helper, "stock-check", "--notify-once"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var m = /^fingerprint=([0-9a-f]{64})$/m.exec(text)
        if (!/^notify=1$/m.test(text) || !m) return
        root.stockFingerprint = m[1]
        notifyProc.command = ["omarchy-notification-send", strings.t("drift.title"), strings.t("drift.body")]
        notifyProc.running = true
      }
    }
    stderr: StdioCollector {
      waitForEnd: true
      onStreamFinished: if (text.trim()) console.warn("battery-insights: " + text.trim())
    }
  }

  Process {
    id: notifyProc
    onExited: function(exitCode) {
      if (exitCode !== 0) {
        console.warn("battery-insights: drift notification not sent (exit " + exitCode + "); will retry at next start")
        return
      }
      ackProc.command = ["bash", root.helper, "stock-ack", root.stockFingerprint]
      ackProc.running = true
    }
  }

  Process {
    id: ackProc
    stderr: StdioCollector {
      waitForEnd: true
      onStreamFinished: if (text.trim()) console.warn("battery-insights: " + text.trim())
    }
  }

  Component.onCompleted: stockProc.running = true
}
