package io.github.yuniquecore.inkmark;

import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Reads user-granted URIs without trusting a provider's reported length. No partial selection commits. */
final class DocumentPicker {
    static List<Map<String, Object>> read(ContentResolver resolver, List<Uri> uris) throws IOException {
        if (uris.size() > 100) throw new IOException("一次最多导入 100 个文件");
        List<Map<String, Object>> result = new ArrayList<>();
        int total = 0;
        for (Uri uri : uris) {
            String name;
            long declared = -1;
            try (Cursor cursor = resolver.query(uri, new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}, null, null, null)) {
                if (cursor == null || !cursor.moveToFirst()) throw new IOException("文件提供程序未返回文件信息");
                name = cursor.getString(0);
                if (!cursor.isNull(1)) declared = cursor.getLong(1);
            }
            if (name == null) throw new IOException("所选文件没有文件名");
            ExportFile.validateName(name);
            int remaining = ExportFile.MAX_BYTES - total;
            if (declared > remaining) throw new IOException("所选文件合计超过 32 MB");
            byte[] bytes;
            try (InputStream input = resolver.openInputStream(uri); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                if (input == null) throw new IOException("无法读取所选文件");
                byte[] buffer = new byte[65536];
                int count;
                while ((count = input.read(buffer, 0, Math.min(buffer.length, remaining - output.size() + 1))) != -1) {
                    if (output.size() + count > remaining) throw new IOException("所选文件合计超过 32 MB");
                    output.write(buffer, 0, count);
                }
                bytes = output.toByteArray();
            }
            total += bytes.length;
            Map<String, Object> file = new HashMap<>();
            file.put("name", name);
            String type = resolver.getType(uri);
            file.put("type", type == null ? "application/octet-stream" : type);
            file.put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP));
            result.add(file);
        }
        return result;
    }
}
