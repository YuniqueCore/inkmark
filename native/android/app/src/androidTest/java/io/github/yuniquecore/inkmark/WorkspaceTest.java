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
import androidx.test.uiautomator.UiObject2;
import androidx.test.uiautomator.UiScrollable;
import androidx.test.uiautomator.UiSelector;
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

    private java.util.Set<String> exportedZips() throws java.io.IOException {
        File directory = new File(context.getCacheDir(), "inkmark-exports");
        if (!directory.exists()) return new java.util.HashSet<>();
        try (var paths = Files.walk(directory.toPath())) {
            return paths.filter(Files::isRegularFile).map(path -> path.toAbsolutePath().toString())
                .filter(path -> path.endsWith(".zip")).collect(java.util.stream.Collectors.toSet());
        }
    }

    @Test public void offlineWorkspaceImportsClipboardImageOpensSystemShareAndRestartsWithData() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
            saved(device);
            action(device, "sample");
            await(scenario, "document.querySelector('#editor')?.textContent.includes('随着人工智能')");
            File image = new File(context.getCacheDir(), "clipboard-test.png");
            Bitmap bitmap = Bitmap.createBitmap(240, 160, Bitmap.Config.ARGB_8888); bitmap.eraseColor(0xff805ad5);
            try (FileOutputStream output = new FileOutputStream(image)) { assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)); }
            bitmap.recycle();
            scenario.onActivity(activity -> ((ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE))
                .setPrimaryClip(ClipData.newUri(activity.getContentResolver(), "picture", FilesProvider.uriFor(activity, image))));
            action(device, "paste-image");
            await(scenario, "document.querySelector('#image-view img')?.naturalWidth === 240"); saved(device);
            UiObject2 coordinates = control(device, "image-coordinates");
            assertTrue("Image must be ready for annotation", coordinates.wait(Until.enabled(true), 10000));
            coordinates.click();
            control(device, "annotation-save");
            capture(device, "image-coordinate-form");
            fillField(device, "region-x", "20"); fillField(device, "region-y", "20");
            fillField(device, "region-width", "9999"); fillField(device, "region-height", "80");
            fillField(device, "annotation-comment", "Native image review");
            control(device, "annotation-comment").findObject(By.clazz(android.widget.EditText.class)).click();
            if (Build.VERSION.SDK_INT >= 30) awaitKeyboard(scenario, true);
            new UiScrollable(new UiSelector().resourceId("form-fields"))
                .scrollIntoView(new UiSelector().resourceId("annotation-kind-question"));
            control(device, "annotation-kind-question").click();
            assertTrue("A single tap must change the kind while the keyboard is open",
                control(device, "annotation-kind-question").wait(Until.selected(true), 10000));
            assertFalse("Out-of-bounds region must not be saved", control(device, "annotation-save").isEnabled());
            fillField(device, "region-width", "100");
            assertTrue("Correcting the region must enable saving", control(device, "annotation-save").wait(Until.enabled(true), 10000));
            control(device, "annotation-save").click();
            boolean submitted = device.wait(Until.gone(By.res("annotation-save")), 10000);
            assertTrue("Saving a valid review must close its native form", submitted);
            if (Build.VERSION.SDK_INT >= 30) awaitKeyboard(scenario, false);
            capture(device, "submitted-image-review");
            saved(device);
            assertEquals("0", evaluate(scenario, "document.querySelectorAll('input,textarea,select,header,aside').length"));
            var existingExports = exportedZips();
            action(device, "export"); control(device, "export-save").click();
            long deadline = System.currentTimeMillis() + 10000;
            while (context.getPackageName().equals(device.getCurrentPackageName()) && System.currentTimeMillis() < deadline) Thread.sleep(100);
            assertNotEquals("System share sheet must leave the activity", context.getPackageName(), device.getCurrentPackageName());
            device.pressBack();
            var createdExports = exportedZips(); createdExports.removeAll(existingExports);
            assertEquals("This share must create exactly one new review archive", 1, createdExports.size());
            File archive = new File(createdExports.iterator().next());
            try (java.util.zip.ZipFile zip = new java.util.zip.ZipFile(archive)) {
                try (var original = zip.getInputStream(zip.getEntry("image-1.png"))) { assertArrayEquals(Files.readAllBytes(image.toPath()), original.readAllBytes()); }
                try (var backup = zip.getInputStream(zip.getEntry("inkmark-documents.json"))) {
                    var document = new org.json.JSONObject(new String(backup.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8)).getJSONArray("docs").getJSONObject(0);
                    assertEquals("Native image review", document.getJSONArray("annotations").getJSONObject(0).getString("comment"));
                    assertEquals("question", document.getJSONArray("annotations").getJSONObject(0).getString("kind"));
                }
            }
            scenario.recreate();
            await(scenario, "document.querySelector('#image-view img')?.naturalWidth === 240");
            saved(device);
            UiObject2 reviews = control(device, "reviews-toggle");
            android.util.Log.i("InkMarkTest", "Review navigation after recreation enabled=" + reviews.isEnabled());
            assertTrue("Wait for the native shell projection, not just the DOM image", reviews.wait(Until.enabled(true), 10000));
            reviews.click();
            boolean opened = reviews.wait(Until.selected(true), 10000);
            if (!opened) capture(device, "review-navigation-after-recreation");
            assertTrue("A single tap must open the native review list", opened);
            assertTrue(device.wait(Until.hasObject(By.text("Native image review")), 10000));
            device.pressBack();
            documentCount(device, 2);
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
            action(device, "files");
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
            saved(device);
            documentCount(device, 2);
            action(device, "files");
            assertTrue(device.wait(Until.hasObject(By.text(name)), 10000));
            device.findObject(By.text(name)).click();
            await(scenario, "document.querySelector('#editor')?.textContent.includes('Recovered picker review')"); saved(device);
            documentCount(device, 3);
        } finally { context.getContentResolver().delete(uri, null, null); }
    }

    private static UiObject2 control(UiDevice device, String id) {
        UiObject2 control = device.wait(Until.findObject(By.res(id)), 10000);
        if (control == null) capture(device, id);
        assertNotNull("Missing native control: " + id, control); return control;
    }
    private static void capture(UiDevice device, String name) {
        String output = InstrumentationRegistry.getArguments().getString("additionalTestOutputDir");
        assertNotNull("Run instrumentation with Gradle's additional test output enabled", output);
        File evidence = new File(output);
        if (evidence.isDirectory() || evidence.mkdirs()) {
            device.takeScreenshot(new File(evidence, name + ".png"));
            try { device.dumpWindowHierarchy(new File(evidence, name + ".xml")); }
            catch (java.io.IOException error) { android.util.Log.w("InkMarkTest", "Could not capture accessibility hierarchy", error); }
        }
    }
    private static void fillField(UiDevice device, String id, String value) throws androidx.test.uiautomator.UiObjectNotFoundException {
        // Focusing the comment opens the keyboard and can scroll coordinates out
        // of view. Follow the native form's real scroll surface to each field.
        new UiScrollable(new UiSelector().resourceId("form-fields"))
            .scrollIntoView(new UiSelector().resourceId(id));
        // NSH assigns testID to InputBox; Android's editable child owns text actions.
        UiObject2 input = control(device, id).findObject(By.clazz(android.widget.EditText.class));
        assertNotNull("Native text editor must exist within " + id, input);
        input.setText(value);
        assertTrue("Native editor must accept the value for " + id, input.wait(Until.textEquals(value), 10000));
    }
    private static void action(UiDevice device, String action) {
        control(device, "workspace-menu").click();
        UiObject2 item = control(device, "action-" + action);
        assertTrue("Workspace action must be enabled: " + action, item.wait(Until.enabled(true), 10000));
        item.click();
    }
    private static void saved(UiDevice device) {
        assertTrue("Native save status must confirm persistence", device.wait(Until.hasObject(By.text("已保存")), 10000));
    }
    @androidx.annotation.RequiresApi(30)
    private static void awaitKeyboard(ActivityScenario<MainActivity> scenario, boolean expected) throws InterruptedException {
        long deadline = System.currentTimeMillis() + 10000;
        boolean[] visible = {!expected};
        do {
            scenario.onActivity(activity -> visible[0] = activity.getWindow().getDecorView()
                .getRootWindowInsets().isVisible(android.view.WindowInsets.Type.ime()));
            if (visible[0] == expected) return;
            Thread.sleep(50);
        } while (System.currentTimeMillis() < deadline);
        capture(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()), "keyboard-visibility-failure");
        fail(expected ? "Native input must open the keyboard before testing option taps"
            : "Submitting a native form must return the full canvas without the keyboard");
    }
    private static void documentCount(UiDevice device, int count) {
        control(device, "documents-toggle").click();
        assertTrue(device.wait(Until.hasObject(By.text("文档 " + count)), 10000));
        device.pressBack();
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
