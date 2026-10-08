package de.stageboard.app;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Printing from the app: Android's WebView ignores window.print(), so "Drucken / als PDF
 * speichern" (band invite) did nothing in the app (2026-10-07). This hands the WebView's content
 * to Android's own print dialog - printers and "Als PDF speichern" - rendered with the page's
 * print styles, so only the print sheet ends up on paper.
 */
@CapacitorPlugin(name = "Print")
public class PrintPlugin extends Plugin {
    @PluginMethod
    public void print(PluginCall call) {
        String name = call.getString("name", "StageBoard");
        getActivity().runOnUiThread(() -> {
            // A device without print support (some Fire OS / stripped ROMs) has no PrintManager -
            // reject instead of crashing the whole app on the UI thread.
            PrintManager printManager = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
            if (printManager == null) {
                call.reject("Drucken wird auf diesem Gerät nicht unterstützt.");
                return;
            }
            try {
                PrintDocumentAdapter adapter = getBridge().getWebView().createPrintDocumentAdapter(name);
                printManager.print(name, adapter, new PrintAttributes.Builder().build());
                call.resolve();
            } catch (RuntimeException e) {
                call.reject("Drucken fehlgeschlagen: " + e.getMessage());
            }
        });
    }
}
