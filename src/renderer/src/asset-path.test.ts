import { describe, expect, it } from 'vitest'
import { assetSrc } from './asset-path'

function localPath(dir: string, destination: string) {
  const result = new URL(assetSrc(dir, destination, 17))
  expect(result.protocol).toBe('md-duck:')
  expect(result.hostname).toBe('asset')
  expect(result.searchParams.get('v')).toBe('17')
  return result.searchParams.get('path')
}

describe('local Markdown image paths', () => {
  it('resolves relative images beside the article on Windows', () => {
    expect(localPath('C:\\Users\\阅读资料\\文章', 'assets/配图%20一.png')).toBe('C:/Users/阅读资料/文章/assets/配图 一.png')
    expect(localPath('C:\\Users\\阅读资料\\文章', '..\\assets\\photo.png')).toBe('C:/Users/阅读资料/assets/photo.png')
    expect(localPath('C:/Users/reader/articles', './assets/../photo.png')).toBe('C:/Users/reader/articles/photo.png')
  })

  it('keeps explicit drive paths absolute instead of appending them to the article folder', () => {
    expect(localPath('C:\\library\\article', 'D:\\图片\\示例 one.png')).toBe('D:/图片/示例 one.png')
    expect(localPath('C:\\library\\article', 'D:/图片/示例%20one.png')).toBe('D:/图片/示例 one.png')
    expect(localPath('C:\\library\\article', '\\images\\photo.png')).toBe('C:/images/photo.png')
    expect(localPath('C:\\library\\article', '/images/photo.png')).toBe('C:/images/photo.png')
    expect(localPath('C:\\library\\article', 'D:/../../photo.png')).toBe('D:/photo.png')
  })

  it('preserves network share roots for relative and absolute paths', () => {
    expect(localPath('\\\\server\\资料\\文章', 'assets/照片.png')).toBe('//server/资料/文章/assets/照片.png')
    expect(localPath('C:\\library', '\\\\server\\资料\\照片 one.png')).toBe('//server/资料/照片 one.png')
    expect(localPath('\\\\server\\资料\\文章', '..\\..\\photo.png')).toBe('//server/资料/photo.png')
    expect(localPath('\\\\server\\资料\\文章', '\\images\\photo.png')).toBe('//server/资料/images/photo.png')
  })

  it('converts file URLs to local assets without exposing unrestricted file URLs to the renderer', () => {
    expect(localPath('C:\\library', 'file:///D:/%E5%9B%BE%E7%89%87/photo%20one.png')).toBe('D:/图片/photo one.png')
    expect(localPath('C:\\library', 'file://server/share/photo%20one.png')).toBe('//server/share/photo one.png')
    expect(localPath('/library', 'file://localhost/Users/reader/配图.png')).toBe('/Users/reader/配图.png')
    expect(localPath('/library', 'file:///Users/reader/hash%23name.png')).toBe('/Users/reader/hash#name.png')
  })

  it('keeps existing macOS/Linux local paths and filename escapes', () => {
    expect(localPath('/home/reader/articles', '../图片/one%20two.png')).toBe('/home/reader/图片/one two.png')
    expect(localPath('/home/reader/articles', '/images/photo.png')).toBe('/images/photo.png')
    expect(localPath('/home/reader/articles', '../../../../../photo.png')).toBe('/photo.png')
    expect(localPath('/home/reader/articles', 'assets/100%25%20photo.png')).toBe('/home/reader/articles/assets/100% photo.png')
    expect(localPath('/home/reader/articles', 'assets/100% photo.png')).toBe('/home/reader/articles/assets/100% photo.png')
  })

  it('only permits existing http(s) remote images and valid local destinations', () => {
    const remote = 'https://example.com/配图.png?size=100#preview'
    expect(assetSrc('C:\\library', remote, 17)).toBe(remote)
    for (const destination of [
      'javascript:alert(1)', 'data:image/png;base64,AAAA', 'ftp://example.com/photo.png',
      'md-duck://asset/?path=/outside/photo.png', 'C:relative.png', 'file://bad:80/photo.png',
      'file:///C:/images%2Fphoto.png', 'file:///C:/images%5Cphoto.png', 'assets/a\0.png', ''
    ]) expect(assetSrc('C:\\library', destination, 17), destination).toBe('')
  })
})
