/**
 * 音频元数据解析工具
 * 使用 music-metadata 解析音频文件的元数据
 */

import { parseBlob, IAudioMetadata } from 'music-metadata';
import { Track } from '../services/audio';

/**
 * 解析音频文件的元数据
 */
export async function parseAudioMetadata(file: File): Promise<Partial<Track>> {
  try {
    const metadata: IAudioMetadata = await parseBlob(file);
    const track: Partial<Track> = {};

    // 基本信息
    if (metadata.common.title) track.title = metadata.common.title;
    if (metadata.common.artist) track.artist = metadata.common.artist;
    if (metadata.common.album) track.album = metadata.common.album;
    if (metadata.common.year) track.year = metadata.common.year;
    if (metadata.common.genre && metadata.common.genre.length > 0) {
      track.genre = metadata.common.genre.join(', ');
    }

    // 专辑艺术家
    if (metadata.common.albumartist) track.albumArtist = metadata.common.albumartist;

    // 音轨信息
    if (metadata.common.track?.no) track.trackNumber = metadata.common.track.no;

    // 唱片编号
    if (metadata.common.disk?.no) track.discNumber = metadata.common.disk.no;

    // 作曲家
    if (metadata.common.composer && metadata.common.composer.length > 0) {
      track.composer = metadata.common.composer.join(', ');
    }

    // 评论
    if (metadata.common.comment && metadata.common.comment.length > 0) {
      track.comment = metadata.common.comment.join('; ');
    }

    // 音频质量信息
    if (metadata.format.bitrate) track.bitrate = Math.round(metadata.format.bitrate / 1000); // kbps
    if (metadata.format.sampleRate) track.sampleRate = metadata.format.sampleRate;

    // 封面图片
    if (metadata.common.picture && metadata.common.picture.length > 0) {
      const picture = metadata.common.picture[0];
      const blob = new Blob([picture.data.buffer || picture.data] as BlobPart[], {
        type: picture.format,
      });
      const coverUrl = URL.createObjectURL(blob);
      track.coverUrl = coverUrl;
    }

    return track;
  } catch (error) {
    console.warn('Failed to parse audio metadata:', error);
    // 解析失败时返回空对象，使用默认值
    return {};
  }
}

/**
 * 从文件名提取标题（去掉扩展名）
 */
export function getTitleFromFilename(filename: string): string {
  return filename.replace(/\.[^/.]+$/, '');
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/**
 * 生成唯一ID
 */
function generateId(): string {
  return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

/**
 * 解析音频文件并返回完整的Track对象
 */
export async function parseAudioFile(file: File): Promise<Track> {
  try {
    // 使用 music-metadata 解析音频文件
    const metadata = await parseBlob(file);
    const common = metadata.common;
    const format = metadata.format;

    // 获取文件路径（如果存在）
    const path = (file as any).webkitRelativePath || file.name;

    // 提取封面
    let coverUrl: string | undefined;
    if (common.picture && common.picture.length > 0) {
      const picture = common.picture[0];
      const blob = new Blob([picture.data.buffer || picture.data] as BlobPart[], {
        type: picture.format,
      });
      coverUrl = URL.createObjectURL(blob);
    }

    return {
      id: generateId(),
      title: common.title || file.name.replace(/\.[^/.]+$/, ''),
      artist: common.artist || common.artists?.join(', ') || undefined,
      album: common.album || undefined,
      path: path,
      duration: format.duration,
      bitrate: format.bitrate ? Math.round(format.bitrate / 1000) : undefined, // kbps
      sampleRate: format.sampleRate,
      codecName: format.codec,
      year: common.year,
      genre: common.genre?.join(', '),
      albumArtist: common.albumartist,
      trackNumber: common.track?.no ?? undefined,
      discNumber: common.disk?.no ?? undefined,
      composer: common.composer?.join(', '),
      comment: common.comment?.join('; '),
      coverUrl: coverUrl,
      fileSize: file.size,
      file: file, // 保留File对象以供播放
      addedAt: new Date(), // 添加时间
    };
  } catch (error) {
    console.error('Failed to parse audio file:', error);
    // 如果解析失败，返回基本信息
    const path = (file as any).webkitRelativePath || file.name;
    return {
      id: generateId(),
      title: file.name.replace(/\.[^/.]+$/, ''),
      file: file,
      fileSize: file.size,
      path: path,
      addedAt: new Date(),
    };
  }
}
