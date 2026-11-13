package com.mycinema.app;

import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import org.json.JSONObject;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ExternalPlayer")
public class ExternalPlayerPlugin extends Plugin {

    private static final String[][] PLAYERS = {
        {"org.videolan.vlc", "org.videolan.vlc.gui.video.VideoPlayerActivity"},
        {"com.mxtech.videoplayer.ad", "com.mxtech.videoplayer.ad.ActivityScreen"},
        {"com.mxtech.videoplayer.pro", "com.mxtech.videoplayer.ActivityScreen"}
    };

    private Intent base(Uri uri, String title) {
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(uri, "video/*");
        i.putExtra("title", title);
        i.putExtra(Intent.EXTRA_TITLE, title);
        return i;
    }

    private void done(PluginCall call, String via) {
        JSObject r = new JSObject();
        r.put("via", via);
        call.resolve(r);
    }

    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url");
        String title = call.getString("title", "");

        if (url == null || url.isEmpty()) {
            call.reject("URL is required");
            return;
        }
        Uri uri = Uri.parse(url);

        // 1. Явний компонент (найнадійніше для ChromeOS)
        for (String[] p : PLAYERS) {
            try {
                Intent i = base(uri, title);
                i.setComponent(new ComponentName(p[0], p[1]));
                getActivity().startActivity(i);
                done(call, "component:" + p[0]);
                return;
            } catch (ActivityNotFoundException | SecurityException ignored) {}
        }

        // 2. Тільки пакет
        for (String[] p : PLAYERS) {
            try {
                Intent i = base(uri, title);
                i.setPackage(p[0]);
                getActivity().startActivity(i);
                done(call, "package:" + p[0]);
                return;
            } catch (ActivityNotFoundException | SecurityException ignored) {}
        }

        // 3. Системний Chooser
        try {
            getActivity().startActivity(Intent.createChooser(base(uri, title), "Open with"));
            done(call, "chooser");
        } catch (ActivityNotFoundException e) {
            call.reject("No video player found", e);
        }
    }

    @PluginMethod
    public void openLampa(PluginCall call) {
        final String lampaPkg = "top.rootu.lampa";
        final String lampaActivity = "top.rootu.lampa.MainActivity";

        PackageManager pm = getContext().getPackageManager();
        try {
            pm.getPackageInfo(lampaPkg, 0);
        } catch (PackageManager.NameNotFoundException e) {
            call.reject("NOT_INSTALLED");
            return;
        }

        Object rawId = call.getData().opt("id");
        String id = (rawId != null && rawId != JSONObject.NULL) ? String.valueOf(rawId).trim() : "";
        String rawType = call.getString("type", "movie");
        String media = "tv".equals(rawType) ? "tv" : "movie";

        if (!id.isEmpty()) {
            Uri tmdbUri = Uri.parse("https://www.themoviedb.org/" + media + "/" + id);

            // 1. Явний компонент Lampa (ChromeOS / ARCVM)
            try {
                Intent i = new Intent(Intent.ACTION_VIEW, tmdbUri);
                i.setComponent(new ComponentName(lampaPkg, lampaActivity));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(i);
                done(call, "component:tmdb");
                return;
            } catch (ActivityNotFoundException | SecurityException ignored) {}

            // 2. Пакет Lampa
            try {
                Intent i = new Intent(Intent.ACTION_VIEW, tmdbUri);
                i.setPackage(lampaPkg);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(i);
                done(call, "package:tmdb");
                return;
            } catch (ActivityNotFoundException | SecurityException ignored) {}
        }

        // 3. Fallback: просто відкрити Lampa
        Intent launch = pm.getLaunchIntentForPackage(lampaPkg);
        if (launch != null) {
            try {
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(launch);
                done(call, "launch-only");
                return;
            } catch (ActivityNotFoundException | SecurityException ignored) {}
        }

        call.reject("OPEN_FAILED");
    }
}
