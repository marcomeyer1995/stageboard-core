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
            PrintManager printManager = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
            PrintDocumentAdapter adapter = getBridge().getWebView().createPrintDocumentAdapter(name);
            printManager.print(name, adapter, new PrintAttributes.Builder().build());
            call.resolve();
        });
    }
}
