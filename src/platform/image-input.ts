import { MAX_IMAGE_BYTES, rasterMediaType, validImageSize, validRaster } from '../core/image'
import type { RasterImage } from '../core/types'
import {imageSize} from 'image-size'

/** Native Windows clipboard DIBs arrive as BMP; ordinary file import stays PNG/JPEG/WebP. */
export async function normalizeClipboardRaster(file: File): Promise<File> {
  if (file.size === 0 || file.size > MAX_IMAGE_BYTES) throw new Error('单张图片须大于 0 字节且不超过 12 MB')
  const header = new Uint8Array(await file.slice(0, 128).arrayBuffer())
  if (header[0] !== 0x42 || header[1] !== 0x4d) return file
  // Read dimensions before asking the browser to allocate a decoded bitmap.
  let size: ReturnType<typeof imageSize>
  try { size = imageSize(header) }
  catch { throw new Error('无法读取剪贴板位图，请重新复制完整图片') }
  if (!validImageSize(size.width, size.height)) throw new Error('剪贴板图片尺寸超过限制（最长边 16384 px、总像素 3200 万）')
  const url = URL.createObjectURL(file)
  const image = new Image()
  const canvas = document.createElement('canvas')
  try {
    image.src = url
    try { await image.decode() }
    catch { throw new Error('无法读取剪贴板位图，请重新复制完整图片') }
    if (image.naturalWidth !== size.width || image.naturalHeight !== size.height) throw new Error('剪贴板图片尺寸无效')
    canvas.width = size.width; canvas.height = size.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法转换剪贴板图片，请将图片保存为 PNG 后导入')
    context.drawImage(image, 0, 0)
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => {
      if (blob) resolve(blob)
      else reject(new Error('无法转换剪贴板图片'))
    }, 'image/png'))
    if (png.size === 0 || png.size > MAX_IMAGE_BYTES) throw new Error('转换后的图片超过 12 MB，请缩小后再导入')
    return new File([png], `${file.name.replace(/\.[^.]+$/, '')}.png`, {type: 'image/png'})
  } finally {
    image.src = ''; canvas.width = 0; canvas.height = 0
    URL.revokeObjectURL(url)
  }
}

export async function decodeRaster(dataUrl: string): Promise<{width: number; height: number}> {
  const image = new Image()
  image.src = dataUrl
  try {
    await image.decode()
    if (!validImageSize(image.naturalWidth, image.naturalHeight)) throw new Error('图片尺寸超过限制（最长边 16384 px、总像素 3200 万）')
    return {width: image.naturalWidth, height: image.naturalHeight}
  } catch (error) {
    if (error instanceof Error && error.message.includes('尺寸')) throw error
    throw new Error('无法读取图片，请使用完整的 PNG、JPEG 或 WebP 文件')
  } finally { image.src = '' }
}

export async function readRaster(file: File): Promise<RasterImage> {
  if (file.size === 0 || file.size > MAX_IMAGE_BYTES) throw new Error('单张图片须大于 0 字节且不超过 12 MB')
  const mediaType = rasterMediaType(new Uint8Array(await file.slice(0, 12).arrayBuffer()))
  if (!mediaType) throw new Error('仅支持 PNG、JPEG、WebP 图片；不支持 SVG 或动画 GIF')
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('读取图片失败，请重试'))
    reader.readAsDataURL(new Blob([file], {type: mediaType}))
  })
  return {dataUrl, ...await decodeRaster(dataUrl)}
}

export async function verifyRaster(image: RasterImage): Promise<void> {
  if (!validRaster(image)) throw new Error('图片数据无效')
  const decoded = await decodeRaster(image.dataUrl)
  if (decoded.width !== image.width || decoded.height !== image.height) throw new Error('图片尺寸与批注坐标系不匹配')
}
