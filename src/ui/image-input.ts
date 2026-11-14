import { MAX_IMAGE_BYTES, rasterMediaType, validImageSize, validRaster } from '../core/image'
import type { RasterImage } from '../core/types'

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
