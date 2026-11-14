package io.github.yuniquecore.inkmark;

import android.content.ClipData;
import android.content.Intent;
import android.content.ClipboardManager;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowInsets;
import android.widget.FrameLayout;
import android.widget.Toast;
import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.EdgeToEdge;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import com.longbridge.nsh.FilesProvider;
import com.longbridge.nsh.NshHostReply;
import com.longbridge.nsh.NshView;
import java.io.File;
import java.util.List;
import java.util.Collections;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** The Android binding owns presentation and temporary exports, never document state. */
public final class MainActivity extends ComponentActivity {
    private NshView workspace;
    private final ExecutorService files = Executors.newSingleThreadExecutor();
    private NshHostReply picking;
    private final ActivityResultLauncher<String[]> pickOne = registerForActivityResult(new ActivityResultContracts.OpenDocument(), uri -> finishPick(uri == null ? Collections.emptyList() : Collections.singletonList(uri)));
    private final ActivityResultLauncher<String[]> pickMany = registerForActivityResult(new ActivityResultContracts.OpenMultipleDocuments(), this::finishPick);

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        EdgeToEdge.enable(this);
        FrameLayout frame = new FrameLayout(this);
        workspace = new NshView(this);
        workspace.setErrorListener(message -> Toast.makeText(this, "工作台加载失败：" + message, Toast.LENGTH_LONG).show());
        workspace.handle("clipboard.image", (data, reply) -> {
            ClipboardManager clipboard = getSystemService(ClipboardManager.class);
            ClipData clip = clipboard.getPrimaryClip();
            Uri uri = clip != null && clip.getItemCount() > 0 ? clip.getItemAt(0).getUri() : null;
            if (uri == null) { reply.resolve(Collections.emptyList()); return; }
            files.execute(() -> {
                try {
                    String type = getContentResolver().getType(uri);
                    reply.resolve(type != null && type.startsWith("image/")
                        ? DocumentPicker.read(getContentResolver(), Collections.singletonList(uri)) : Collections.emptyList());
                } catch (Exception error) { reply.reject(error.getMessage()); }
            });
        });
        workspace.handle("files.pick", (data, reply) -> {
            if (picking != null) { reply.reject("请先完成当前文件选择"); return; }
            if (!(data instanceof Map<?, ?> options) || !(options.get("multiple") instanceof Boolean multiple)
                || !Boolean.FALSE.equals(options.get("directory"))) { reply.reject("无效的文件选择请求"); return; }
            picking = reply;
            String[] types = options.get("extensions") instanceof List<?> extensions && extensions.equals(Collections.singletonList("json"))
                ? new String[]{"application/json", "application/octet-stream"} : new String[]{"text/*", "application/json", "image/png", "image/jpeg", "image/webp", "application/octet-stream"};
            try { if (multiple) pickMany.launch(types); else pickOne.launch(types); }
            catch (Exception error) { picking = null; reply.reject(error.getMessage()); }
        });
        workspace.handle("files.export", (data, reply) -> files.execute(() -> {
            try {
                ExportFile request = ExportFile.parse(data);
                File output = request.write(new File(getCacheDir(), "inkmark-exports"));
                runOnUiThread(() -> {
                    try {
                        if (isFinishing() || isDestroyed()) throw new IllegalStateException("应用已关闭");
                        Uri uri = FilesProvider.uriFor(this, output);
                        if (uri == null) throw new IllegalStateException("导出文件不可共享");
                        Intent send = new Intent(Intent.ACTION_SEND).setType(request.mediaType);
                        send.putExtra(Intent.EXTRA_STREAM, uri);
                        send.setClipData(ClipData.newRawUri(request.name, uri));
                        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        startActivity(Intent.createChooser(send, "导出 InkMark 文件"));
                        reply.resolve("shared");
                    } catch (Exception error) { reply.reject(error.getMessage()); }
                });
            } catch (Exception error) { reply.reject(error.getMessage()); }
        }));
        frame.addView(workspace, new FrameLayout.LayoutParams(-1, -1));
        if (Build.VERSION.SDK_INT >= 30) {
            frame.setOnApplyWindowInsetsListener((view, insets) -> {
                Insets safe = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
                return insets;
            });
        } else { frame.setFitsSystemWindows(true); }
        setContentView(frame);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (!workspace.handleBack()) moveTaskToBack(true);
            }
        });
        if (!workspace.loadAssetBundle("nsh")) Toast.makeText(this, "工作台资源无法加载，请重新安装 InkMark", Toast.LENGTH_LONG).show();
    }

    private void finishPick(List<Uri> uris) {
        NshHostReply reply = picking;
        picking = null;
        if (reply == null) {
            if (!uris.isEmpty()) Toast.makeText(this, "文件选择因工作台重新载入而中断，请重新打开文件", Toast.LENGTH_LONG).show();
            return;
        }
        files.execute(() -> {
            try { reply.resolve(DocumentPicker.read(getContentResolver(), uris)); }
            catch (Exception error) { reply.reject(error.getMessage()); }
        });
    }

    @Override protected void onDestroy() {
        if (picking != null) { picking.reject("应用已关闭"); picking = null; }
        workspace.destroy();
        files.shutdown();
        super.onDestroy();
    }
}
