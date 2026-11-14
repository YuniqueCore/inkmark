package io.github.yuniquecore.inkmark;

import static org.junit.Assert.*;
import android.content.Context;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentValues;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.view.accessibility.AccessibilityEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.Until;
import com.longbridge.nsh.FilesProvider;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import java.io.FileOutputStream;
import java.io.RandomAccessFile;
import java.nio.file.Files;
import java.util.Collections;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;

@RunWith(AndroidJUnit4.class)
public class WorkspaceTest {
    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();

    @Test public void transferRejectsTraversalAndOversizeAndRetainsExactSharedBytes() throws Exception {
        for (String name : new String[]{"../secret", "a\\b", "a\n/../b", ".", ".."}) {
            assertThrows(IllegalArgumentException.class, () -> ExportFile.parse(Map.of("name", name, "type", "application/json", "base64", "e30=")));
        }
        File cache = new File(context.getCacheDir(), "adapter-test");
        File output = ExportFile.parse(Map.of("name", "审阅.json", "type", "application/json", "base64", "eyJvayI6dHJ1ZX0=")).write(cache);
        Uri uri = FilesProvider.uriFor(context, output);
        try (var input = context.getContentResolver().openInputStream(uri)) {
            assertNotNull(input); assertEquals("{\"ok\":true}", new String(input.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8));
        }
        assertEquals("审阅.json", DocumentPicker.read(context.getContentResolver(), Collections.singletonList(uri)).get(0).get("name"));
        try (RandomAccessFile sparse = new RandomAccessFile(output, "rw")) { sparse.setLength((long) ExportFile.MAX_BYTES + 1); }
        assertThrows(java.io.IOException.class, () -> DocumentPicker.read(context.getContentResolver(), Collections.singletonList(uri)));
        assertThrows(java.io.IOException.class, () -> DocumentPicker.read(context.getContentResolver(), Collections.nCopies(101, uri)));
        Files.delete(output.toPath()); Files.delete(output.getParentFile().toPath()); Files.delete(cache.toPath());
    }

    @Test public void offlineWorkspaceImportsClipboardImageOpensSystemShareAndRestartsWithData() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            await(scenario, "document.querySelector('#save-text')?.textContent === '已保存'");
            evaluate(scenario, "document.querySelector('#btn-import').click();document.querySelector('[data-menu-id=sample]').click()");
            await(scenario, "document.querySelector('#editor')?.textContent.includes('随着人工智能')");
            File image = new File(context.getCacheDir(), "clipboard-test.png");
            Bitmap bitmap = Bitmap.createBitmap(240, 160, Bitmap.Config.ARGB_8888); bitmap.eraseColor(0xff805ad5);
            try (FileOutputStream output = new FileOutputStream(image)) { assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)); }
            bitmap.recycle();
            scenario.onActivity(activity -> ((ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE))
                .setPrimaryClip(ClipData.newUri(activity.getContentResolver(), "picture", FilesProvider.uriFor(activity, image))));
            evaluate(scenario, "document.querySelector('#btn-import').click();document.querySelector('[data-menu-id=image-paste]').click()");
            await(scenario, "document.querySelector('#image-view img')?.naturalWidth === 240 && document.querySelector('#save-text')?.textContent === '已保存'");
            assertEquals("true", evaluate(scenario, "document.querySelector('#btn-edit').disabled"));
            evaluate(scenario, "document.querySelector('[data-image-action=coordinates]').click()");
            await(scenario, "!!document.querySelector('[data-image-form]')");
            evaluate(scenario, "for(const [key,value] of Object.entries({x:20,y:20,width:9999,height:80})){const el=document.querySelector('[data-coordinate='+key+']');el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}))}");
            assertEquals("true", evaluate(scenario, "document.querySelector('[data-image-save]').disabled"));
            evaluate(scenario, "const width=document.querySelector('[data-coordinate=width]');width.value=100;width.dispatchEvent(new Event('input',{bubbles:true}));const comment=document.querySelector('[data-image-form] textarea');comment.value='Native image review';comment.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-image-save]').click()");
            await(scenario, "document.querySelector('#sidebar')?.textContent.includes('Native image review') && document.querySelector('#save-text')?.textContent === '已保存'");
            evaluate(scenario, "document.querySelector('#btn-export').click();document.querySelector('#export-modal [data-op=download]').click()");
            UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
            long deadline = System.currentTimeMillis() + 10000;
            while (context.getPackageName().equals(device.getCurrentPackageName()) && System.currentTimeMillis() < deadline) Thread.sleep(100);
            assertNotEquals("System share sheet must leave the activity", context.getPackageName(), device.getCurrentPackageName());
            device.pressBack();
            File[] shares = new File(context.getCacheDir(), "inkmark-exports").listFiles();
            assertNotNull(shares);
            File archive = java.util.Arrays.stream(shares).flatMap(directory -> java.util.Arrays.stream(directory.listFiles()))
                .filter(file -> file.getName().endsWith(".zip")).findFirst().orElseThrow();
            try (java.util.zip.ZipFile zip = new java.util.zip.ZipFile(archive)) {
                try (var original = zip.getInputStream(zip.getEntry("image-1.png"))) { assertArrayEquals(Files.readAllBytes(image.toPath()), original.readAllBytes()); }
                try (var backup = zip.getInputStream(zip.getEntry("inkmark-documents.json"))) {
                    var document = new org.json.JSONObject(new String(backup.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8)).getJSONArray("docs").getJSONObject(0);
                    assertEquals("Native image review", document.getJSONArray("annotations").getJSONObject(0).getString("comment"));
                }
            }
            scenario.recreate();
            await(scenario, "document.querySelector('#image-view img')?.naturalWidth === 240");
            assertEquals("true", evaluate(scenario, "document.querySelector('#sidebar')?.textContent.includes('Native image review')"));
            assertEquals("2", evaluate(scenario, "document.querySelectorAll('#filetree [data-doc]').length"));
            Files.delete(image.toPath());
            if (Build.VERSION.SDK_INT >= 29) interruptedPickerCanBeRetried(scenario, device);
        }
    }

    @androidx.annotation.RequiresApi(29)
    private void interruptedPickerCanBeRetried(ActivityScenario<MainActivity> scenario, UiDevice device) throws Exception {
        String name = "InkMark-picker-" + System.currentTimeMillis() + ".txt";
        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME, name);
        values.put(MediaStore.Downloads.MIME_TYPE, "text/plain");
        values.put(MediaStore.Downloads.IS_PENDING, 1);
        Uri uri = context.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        assertNotNull(uri);
        try {
            try (var output = context.getContentResolver().openOutputStream(uri)) {
                assertNotNull(output); output.write("Recovered picker review".getBytes(java.nio.charset.StandardCharsets.UTF_8));
            }
            values.clear(); values.put(MediaStore.Downloads.IS_PENDING, 0);
            context.getContentResolver().update(uri, values, null, null);
            evaluate(scenario, "document.querySelector('#btn-import').click();document.querySelector('[data-menu-id=files]').click()");
            assertTrue("Real system picker should show the fixture", device.wait(Until.hasObject(By.text(name)), 10000));
            // ActivityScenario.recreate first resumes the app; the real picker deliberately owns the foreground.
            var instrumentation = InstrumentationRegistry.getInstrumentation();
            var monitor = instrumentation.addMonitor(MainActivity.class.getName(), null, false);
            try {
                scenario.onActivity(MainActivity::recreate);
                assertNotNull("Background activity must actually be recreated", monitor.waitForActivityWithTimeout(10000));
            } finally { instrumentation.removeMonitor(monitor); }
            assertTrue(device.wait(Until.hasObject(By.text(name)), 10000));
            AccessibilityEvent notice = InstrumentationRegistry.getInstrumentation().getUiAutomation().executeAndWaitForEvent(
                () -> device.findObject(By.text(name)).click(),
                event -> event.getEventType() == AccessibilityEvent.TYPE_NOTIFICATION_STATE_CHANGED
                    && event.getText().toString().contains("文件选择因工作台重新载入而中断"), 10000);
            assertNotNull(notice);
            await(scenario, "document.querySelector('#save-text')?.textContent === '已保存'");
            assertEquals("2", evaluate(scenario, "document.querySelectorAll('#filetree [data-doc]').length"));
            evaluate(scenario, "document.querySelector('#btn-import').click();document.querySelector('[data-menu-id=files]').click()");
            assertTrue(device.wait(Until.hasObject(By.text(name)), 10000));
            device.findObject(By.text(name)).click();
            await(scenario, "document.querySelector('#editor')?.textContent.includes('Recovered picker review') && document.querySelector('#save-text')?.textContent === '已保存'");
            assertEquals("3", evaluate(scenario, "document.querySelectorAll('#filetree [data-doc]').length"));
        } finally { context.getContentResolver().delete(uri, null, null); }
    }

    private static WebView web(View view) {
        if (view instanceof WebView browser) return browser;
        if (view instanceof ViewGroup group) for (int i = 0; i < group.getChildCount(); i++) { WebView found = web(group.getChildAt(i)); if (found != null) return found; }
        return null;
    }
    private static String evaluate(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        ArrayBlockingQueue<String> result = new ArrayBlockingQueue<>(1);
        scenario.onActivity(activity -> {
            WebView browser = web(activity.getWindow().getDecorView());
            if (browser == null) result.offer("null"); else browser.evaluateJavascript(script, result::offer);
        });
        String value = result.poll(5, TimeUnit.SECONDS); assertNotNull("WebView did not answer", value); return value;
    }
    private static void await(ActivityScenario<MainActivity> scenario, String predicate) throws Exception {
        long deadline = System.currentTimeMillis() + 15000;
        do { if ("true".equals(evaluate(scenario, predicate))) return; Thread.sleep(50); } while (System.currentTimeMillis() < deadline);
        fail("Timed out: " + predicate + "; page=" + evaluate(scenario, "document.body.innerText"));
    }
}
