package com.mycinema.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Ім'я класу й плагіна ("ExternalPlayer") лишаємо, щоб не чіпати MainActivity.java
@CapacitorPlugin(name = "ExternalPlayer")
public class ExternalPlayerPlugin extends Plugin {
    private static final String LAMPA_PKG = "top.rootu.lampa";

    @PluginMethod
    public void openLampa(PluginCall call) {
        Integer id = call.getInt("id");
        if (id == null) { call.reject("NO_ID"); return; }
        String type = "tv".equals(call.getString("type", "movie")) ? "tv" : "movie";

        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("http://www.themoviedb.org/" + type + "/" + id));
        intent.setPackage(LAMPA_PKG);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            JSObject r = new JSObject();
            r.put("via", "tmdb-link");
            call.resolve(r);
        } catch (ActivityNotFoundException e) {
            Intent launch = getContext().getPackageManager().getLaunchIntentForPackage(LAMPA_PKG);
            if (launch == null) { call.reject("NOT_INSTALLED"); return; }
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(launch);
            JSObject r = new JSObject();
            r.put("via", "launch-only");
            call.resolve(r);
        }
    }
}
