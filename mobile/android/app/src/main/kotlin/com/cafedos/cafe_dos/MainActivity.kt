package com.cafedos.cafe_dos

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.util.concurrent.Executors

class MainActivity : FlutterActivity() {
    private val recoveryExecutor = Executors.newSingleThreadExecutor()

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        val storage by lazy { RecoveryStorage(applicationContext) }
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "com.cafedos/recovery")
            .setMethodCallHandler { call, result ->
                if (call.method != "read" && call.method != "write") {
                    result.notImplemented()
                    return@setMethodCallHandler
                }
                recoveryExecutor.execute {
                    try {
                        val response = if (call.method == "read") storage.read() else {
                            val arguments = call.arguments as Map<*, *>
                            require(arguments.keys == setOf("value", "expected"))
                            storage.write(arguments["value"] as String, arguments["expected"] as String?)
                            true
                        }
                        runOnUiThread { result.success(response) }
                    } catch (_: Exception) {
                        runOnUiThread { result.error("recovery_storage_unavailable", "Saved device state is unavailable.", null) }
                    }
                }
            }
    }

    override fun onDestroy() {
        recoveryExecutor.shutdown()
        super.onDestroy()
    }
}
