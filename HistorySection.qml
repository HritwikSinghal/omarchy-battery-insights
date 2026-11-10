import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "Model.js" as Model
import "UiState.js" as UiState

// The battery panel's HISTORY section: one graph at a time (battery level,
// usage, or health), picked from a dropdown, with a range row for the first
// two and a short stats block under each. The data comes from the log the
// service keeps (bin/battery-insights); this side only reads it, and only
// while the panel is open.
//
// The section does not own the choice: it shows `graph` / `range` and asks
// for changes through graphPicked / rangePicked, so the widget can persist
// them and every bar's copy stays in step.
Item {
  id: root

  property bool active: false
  property string graph: "level"
  property string range: "24h"
  property string stateDir: ""
  property string helper: ""
  property var service: null
  property color foreground: Color.foreground
  property string fontFamily: Style.font.family

  signal graphPicked(string value)
  signal rangePicked(string value)
  // The dropdown takes keyboard focus when clicked; the panel takes it back
  // when the popup closes so Esc, Tab and the arrows keep working.
  signal pickerClosed()

  // "dropdown", or "buttons" if the dropdown ever has to be swapped for a row
  // of buttons (see the design doc); reported in the widget's state().
  readonly property string picker: "dropdown"

  property var samples: []
  property var healthRows: []
  property var info: ({})
  property var report: null
  property var health: null
  property color chargeColor: Color.accent

  implicitHeight: column.implicitHeight

  Commons.Translations { id: strings; directory: Qt.resolvedUrl("i18n") }

  readonly property var graphOptions: [
    { value: "level", label: strings.t("history.graph.level") },
    { value: "usage", label: strings.t("history.graph.usage") },
    { value: "health", label: strings.t("history.graph.health") }
  ]
  readonly property var rangeOptions: [
    { value: "24h", label: strings.t("history.range.24h") },
    { value: "7d", label: strings.t("history.range.7d") },
    { value: "30d", label: strings.t("history.range.30d") }
  ]

  function rebuild() {
    var now = Math.floor(Date.now() / 1000)
    report = Model.buildReport(samples, UiState.isRange(range) ? range : "24h", now)
    health = Model.healthReport(info, healthRows, now)
  }

  function refresh() {
    samplesFile.reload()
    healthFile.reload()
    if (!infoProc.running) infoProc.running = true
    if (service && service.sampleNow) service.sampleNow()
  }

  onRangeChanged: rebuild()
  onActiveChanged: {
    if (active) {
      refresh()
    } else {
      graphDropdown.close()
      // A month of minute readings is a few MB once parsed; only hold it
      // while the panel is up.
      samples = []
    }
  }
  Component.onCompleted: if (active) refresh()

  FileView {
    id: samplesFile
    path: root.active && root.stateDir !== "" ? root.stateDir + "/samples.csv" : ""
    printErrors: false
    watchChanges: true
    onFileChanged: reload()
    onLoaded: { root.samples = Model.parseSamples(text()); root.rebuild() }
    onLoadFailed: { root.samples = []; root.rebuild() }
  }

  FileView {
    id: healthFile
    path: root.active && root.stateDir !== "" ? root.stateDir + "/health.csv" : ""
    printErrors: false
    watchChanges: true
    onFileChanged: reload()
    onLoaded: { root.healthRows = Model.parseHealth(text()); root.rebuild() }
    onLoadFailed: { root.healthRows = []; root.rebuild() }
  }

  // Charging draws in the theme's green, falling back to the accent for
  // themes without one.
  FileView {
    path: Color.currentThemePath + "/colors.toml"
    printErrors: false
    watchChanges: true
    onFileChanged: reload()
    onLoaded: {
      var m = /^\s*(?:green|color2)\s*=\s*"(#[0-9a-fA-F]{6,8})"/m.exec(text())
      root.chargeColor = m ? m[1] : Color.accent
    }
  }

  Process {
    id: infoProc
    command: ["bash", root.helper, "info"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: { root.info = Model.parseInfo(text); root.rebuild() }
    }
  }

  // Keep "now" moving while the panel stays open.
  Timer {
    interval: 60000
    running: root.active
    repeat: true
    onTriggered: root.rebuild()
  }

  Column {
    id: column
    width: parent.width
    spacing: Style.space(10)

    // ---------- Header: HISTORY + graph dropdown ----------
    Item {
      width: parent.width
      implicitHeight: Math.max(header.implicitHeight, graphDropdown.implicitHeight)

      PanelSectionHeader {
        id: header
        anchors.left: parent.left
        anchors.verticalCenter: parent.verticalCenter
        text: strings.t("history.title")
        foreground: root.foreground
        fontFamily: root.fontFamily
      }

      Dropdown {
        id: graphDropdown
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        width: Style.space(150)
        showLabel: false
        options: root.graphOptions
        value: root.graph
        foreground: root.foreground
        fontFamily: root.fontFamily
        onChanged: function(value) {
          root.graphPicked(value)
          // Selecting assigns Dropdown.value, which drops this binding; put it
          // back so a pick made elsewhere (IPC, another monitor) still shows.
          graphDropdown.value = Qt.binding(function() { return root.graph })
        }
        onPopupOpenChanged: if (!popupOpen) root.pickerClosed()
      }
    }

    ButtonGroup {
      visible: root.graph !== "health"
      width: parent.width
      options: root.rangeOptions
      value: root.range
      focusable: false
      foreground: root.foreground
      fontFamily: root.fontFamily
      fontSize: Style.font.bodySmall
      onChanged: function(value) { root.rangePicked(value) }
    }

    // ---------- Battery level ----------
    LevelChart {
      id: levelChart
      visible: root.graph === "level"
      width: parent.width
      height: Style.space(112)
      report: root.report
      foreground: root.foreground
      accent: root.chargeColor
      fontFamily: root.fontFamily
    }

    // ---------- Usage ----------
    UsageChart {
      id: usageChart
      visible: root.graph === "usage"
      width: parent.width
      height: Style.space(76)
      report: root.report
      foreground: root.foreground
      fontFamily: root.fontFamily
    }

    // Hover readout under the level and usage charts; the usage legend and
    // unit when nothing is hovered. Always laid out, so hovering never makes
    // the panel jump.
    Item {
      visible: root.graph !== "health"
      width: parent.width
      implicitHeight: readoutText.implicitHeight

      Text {
        id: readoutText
        anchors.left: parent.left
        anchors.right: legend.visible ? legend.left : parent.right
        anchors.rightMargin: legend.visible ? Style.space(10) : 0
        elide: Text.ElideRight
        textFormat: Text.PlainText
        text: {
          var hover = root.graph === "level" ? levelChart.readout : usageChart.readout
          if (hover !== "") return hover
          if (root.graph !== "usage") return " "
          return root.report && root.report.unit === "hour" ? strings.t("history.usagePerHour") : strings.t("history.usagePerDay")
        }
        color: root.foreground
        opacity: 0.8
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
      }

      Row {
        id: legend
        visible: root.graph === "usage" && usageChart.readout === ""
        anchors.right: parent.right
        anchors.verticalCenter: readoutText.verticalCenter
        spacing: Style.space(10)

        LegendKey { label: strings.t("history.awake"); swatchOpacity: 0.9 }
        LegendKey { label: strings.t("history.asleep"); swatchOpacity: 0.3 }
      }
    }

    Text {
      // A single reading counts as data but draws no line (a line needs two
      // points), so the level graph would otherwise sit blank with no word.
      visible: root.graph !== "health" && !!root.report
        && (!root.report.hasData || (root.graph === "level" && root.report.level.length < 2))
      width: parent.width
      wrapMode: Text.WordWrap
      text: strings.t("history.empty")
      textFormat: Text.PlainText
      color: root.foreground
      opacity: 0.6
      font.family: root.fontFamily
      font.pixelSize: Style.font.bodySmall
    }

    // ---------- Range stats (level and usage) ----------
    Column {
      visible: root.graph !== "health" && !!root.report
      width: parent.width
      spacing: Style.spacing.labelGap

    Grid {
      width: parent.width
      columns: 2
      columnSpacing: Style.space(20)
      rowSpacing: Style.spacing.labelGap
      readonly property real cellWidth: (width - columnSpacing) / 2

      Stat {
        width: parent.cellWidth
        label: strings.t("stats.onBattery")
        value: root.report ? Model.formatDuration(root.report.totals.batterySec) : "\u2014"
      }
      Stat {
        width: parent.cellWidth
        label: strings.t("stats.used")
        value: root.report ? Math.round(root.report.totals.awake + root.report.totals.sleep) + "% \u00b7 "
          + (root.report.totals.awakeWh + root.report.totals.sleepWh).toFixed(1) + " Wh" : "\u2014"
      }
      Stat {
        width: parent.cellWidth
        label: strings.t("stats.avgDrain")
        value: root.report && root.report.drainW !== null
          ? root.report.drainW.toFixed(1) + " W \u00b7 " + root.report.drainPctH.toFixed(1) + "%/h" : "\u2014"
      }
      Stat {
        width: parent.cellWidth
        label: strings.t("stats.fullChargeLasts")
        value: root.report && root.report.runtimeH !== null ? "~" + Model.formatHours(root.report.runtimeH) : "\u2014"
      }
      Stat {
        width: parent.cellWidth
        label: strings.t("stats.sleepDrain")
        value: root.report && root.report.sleepPctH !== null ? root.report.sleepPctH.toFixed(2) + "%/h" : "\u2014"
      }
    }

      // A full row: "93% \u00b7 Yesterday 23:00" does not fit half the panel.
      Stat {
        width: parent.width
        label: strings.t("stats.lastCharged")
        value: {
          var c = root.report ? root.report.lastCharge : null
          if (!c) return "\u2014"
          if (c.charging) return strings.t("stats.chargingNow")
          return Math.round(c.p) + "% \u00b7 " + Model.formatWhen(c.t, root.report.now)
        }
      }
    }

    // ---------- Health ----------
    Text {
      visible: root.graph === "health" && !root.health
      width: parent.width
      wrapMode: Text.WordWrap
      text: strings.t("health.empty")
      textFormat: Text.PlainText
      color: root.foreground
      opacity: 0.6
      font.family: root.fontFamily
      font.pixelSize: Style.font.bodySmall
    }

    Item {
      visible: root.graph === "health" && !!root.health
      width: parent.width
      implicitHeight: Math.max(capacityValue.implicitHeight, capacityLabels.implicitHeight)

      Text {
        id: capacityValue
        anchors.left: parent.left
        anchors.verticalCenter: parent.verticalCenter
        text: root.health ? Model.formatPercent(root.health.capacity, 1) : ""
        textFormat: Text.PlainText
        color: root.foreground
        font.family: root.fontFamily
        font.pixelSize: Style.font.display
        font.bold: true
      }

      Column {
        id: capacityLabels
        anchors.left: capacityValue.right
        anchors.leftMargin: Style.space(12)
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        spacing: Style.space(1)

        Item {
          width: parent.width
          implicitHeight: capacityTitle.implicitHeight

          Text {
            id: capacityTitle
            anchors.left: parent.left
            text: strings.t("health.maxCapacity")
            textFormat: Text.PlainText
            color: root.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
          }
          Text {
            anchors.right: parent.right
            anchors.baseline: capacityTitle.baseline
            text: root.health ? root.health.condition : ""
            textFormat: Text.PlainText
            color: root.health && root.health.capacity < Model.HEALTH_SERVICE_THRESHOLD ? Color.urgent : root.foreground
            opacity: 0.8
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
          }
        }
        Text {
          text: root.health
            ? strings.t("health.designLine").arg(root.health.fullWh.toFixed(1)).arg(root.health.designWh.toFixed(1)).arg(Model.formatPercent(root.health.loss, 1))
            : ""
          textFormat: Text.PlainText
          color: root.foreground
          opacity: 0.6
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          elide: Text.ElideRight
          width: parent.width
        }
      }
    }

    HealthChart {
      visible: root.graph === "health" && !!root.health
      width: parent.width
      height: Style.space(84)
      health: root.health
      nowSec: root.report ? root.report.now : Date.now() / 1000
      foreground: root.foreground
      accent: Color.accent
      warning: Color.urgent
      fontFamily: root.fontFamily
    }

    Grid {
      visible: root.graph === "health" && !!root.health
      width: parent.width
      columns: 2
      columnSpacing: Style.space(20)
      rowSpacing: Style.spacing.labelGap
      readonly property real cellWidth: (width - columnSpacing) / 2

      Stat {
        width: parent.cellWidth
        label: strings.t("health.cycles")
        value: root.health && root.health.cycles > 0 ? String(root.health.cycles) : "\u2014"
      }
      Stat {
        width: parent.cellWidth
        label: strings.t("health.age")
        value: root.health ? Model.formatYears(root.health.ageYears) : "\u2014"
      }
      Stat {
        width: parent.cellWidth
        label: strings.t("health.per100")
        value: root.health ? Model.formatPercent(root.health.per100Cycles, 1) : "\u2014"
      }
      Stat {
        width: parent.cellWidth
        label: strings.t("health.perYear")
        value: root.health ? Model.formatPercent(root.health.perYear, 1) : "\u2014"
      }
      Stat {
        width: parent.cellWidth
        label: strings.t("health.trend")
        value: {
          var h = root.health
          if (!h) return "\u2014"
          if (h.trend) return strings.t("health.trendValue").arg(Model.formatTrend(h.trend.perYear))
          var w = Model.trendWaiting(h.history || [])
          if (!w) return "\u2014"
          return strings.t(w.what === "days" ? "health.tracking" : "health.trackingReadings").arg(w.have).arg(w.need)
        }
      }
      Stat {
        width: parent.cellWidth
        label: strings.t("health.reaches80")
        value: {
          var h = root.health
          if (!h) return "\u2014"
          if (h.capacity < Model.HEALTH_SERVICE_THRESHOLD) return strings.t("health.alreadyBelow")
          return h.yearsTo80 !== null ? strings.t("health.inAbout").arg(Model.formatYears(h.yearsTo80)) : "\u2014"
        }
      }
    }
  }

  component LegendKey: Row {
    property string label: ""
    property real swatchOpacity: 1
    spacing: Style.space(4)

    Rectangle {
      width: Style.space(8)
      height: Style.space(8)
      anchors.verticalCenter: parent.verticalCenter
      color: root.foreground
      opacity: parent.swatchOpacity
    }
    Text {
      text: parent.label
      textFormat: Text.PlainText
      color: root.foreground
      opacity: 0.6
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
    }
  }

  component Stat: Item {
    property string label: ""
    property string value: ""
    implicitHeight: Math.max(statLabel.implicitHeight, statValue.implicitHeight)

    Text {
      id: statLabel
      anchors.left: parent.left
      text: parent.label
      textFormat: Text.PlainText
      color: root.foreground
      opacity: 0.6
      font.family: root.fontFamily
      font.pixelSize: Style.font.bodySmall
    }
    Text {
      id: statValue
      anchors.right: parent.right
      anchors.left: statLabel.right
      anchors.leftMargin: Style.space(8)
      horizontalAlignment: Text.AlignRight
      elide: Text.ElideRight
      text: parent.value
      textFormat: Text.PlainText
      color: root.foreground
      font.family: root.fontFamily
      font.pixelSize: Style.font.bodySmall
    }
  }
}
