import QtQml 2.15

QtObject {
    readonly property string adapterId: "utils.qt.adapter"
    readonly property string contractVersion: "1.0"
    readonly property string lane: "sidecar-native-adapter"
    readonly property bool hostVisibleUiCarrier: false
    readonly property bool sidecarOwnsTopLevelWindow: false
    readonly property var supportedSurfaces: ["command"]
    readonly property var requiredHostBoundaries: [
        "runtime-resolver",
        "launcher-registry",
        "shell-surface-manager",
        "runtime-bridge",
        "capability-protocol",
        "telemetry-cleanup"
    ]
}
