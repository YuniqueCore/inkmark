package io.github.yuniquecore.inkmark;

import android.util.Base64;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.util.Map;
import java.util.Arrays;
import java.util.UUID;

/** A file handoff. Caller-provided paths and executable content types are not accepted. */
final class ExportFile {
    static final int MAX_BYTES = 32 * 1024 * 1024;
    private static final long RETAIN_MS = 24 * 60 * 60 * 1000L;
    private static final long CACHE_BYTES = 512 * 1024 * 1024L;
    final String name;
    final String mediaType;
    private final byte[] bytes;

    private ExportFile(String name, String mediaType, byte[] bytes) { this.name = name; this.mediaType = mediaType; this.bytes = bytes; }

    static ExportFile parse(Object value) {
        if (!(value instanceof Map<?, ?> data) || data.size() != 3
            || !(data.get("name") instanceof String name) || !(data.get("type") instanceof String type)
            || !(data.get("base64") instanceof String encoded)) throw new IllegalArgumentException("无效的导出请求");
        validateName(name);
        String mime = type.split(";", 2)[0];
        if (!Arrays.asList("application/json", "application/zip", "text/markdown", "text/plain").contains(mime)) throw new IllegalArgumentException("不支持的导出类型");
        if (encoded.length() > ((long) MAX_BYTES + 2) / 3 * 4) throw new IllegalArgumentException("导出文件超过 32 MB");
        byte[] bytes = Base64.decode(encoded, Base64.NO_WRAP);
        if (bytes.length > MAX_BYTES) throw new IllegalArgumentException("导出文件超过 32 MB");
        return new ExportFile(name, mime, bytes);
    }

    static void validateName(String name) {
        if (name.isEmpty() || name.length() > 255 || name.equals(".") || name.equals("..")) throw new IllegalArgumentException("无效的文件名");
        for (int i = 0; i < name.length(); i++) {
            char c = name.charAt(i);
            if (c == '/' || c == '\\' || c < 0x20 || c == 0x7f) throw new IllegalArgumentException("无效的文件名");
        }
    }

    File write(File cache) throws IOException {
        Files.createDirectories(cache.toPath());
        long used = 0;
        File[] entries = cache.listFiles();
        if (entries == null) throw new IOException("导出缓存不可用");
        for (File directory : entries) {
            File[] files = directory.listFiles();
            if (files == null) continue;
            for (File file : files) {
                if (System.currentTimeMillis() - file.lastModified() > RETAIN_MS) Files.delete(file.toPath());
                else used += file.length();
            }
            String[] remaining = directory.list();
            if (remaining != null && remaining.length == 0) Files.delete(directory.toPath());
        }
        if (used + bytes.length > CACHE_BYTES) throw new IOException("导出缓存已满，请在系统设置中清理 InkMark 缓存后重试");
        File directory = new File(cache, UUID.randomUUID().toString());
        Files.createDirectory(directory.toPath());
        File file = new File(directory, name);
        try { Files.write(file.toPath(), bytes); }
        catch (IOException error) { Files.deleteIfExists(file.toPath()); Files.deleteIfExists(directory.toPath()); throw error; }
        return file;
    }
}
