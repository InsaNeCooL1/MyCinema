package com.mycinema.app;

import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Intent;
import android.net.Uri;
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
}
