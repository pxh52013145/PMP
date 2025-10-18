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
      const blob = new Blob([picture.data], { type: picture.format });
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
