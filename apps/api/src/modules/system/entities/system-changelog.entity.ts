import {
  Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Index,
} from 'typeorm';

export enum ChangelogType {
  FEATURE = 'feature',
  IMPROVEMENT = 'improvement',
  FIX = 'fix',
}

@Entity('system_changelog')
@Index('idx_changelog_published', ['publishedAt'])
export class SystemChangelog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 20 })
  version: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'enum', enum: ChangelogType, default: ChangelogType.FEATURE })
  type: ChangelogType;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive: boolean;

  @Column({ type: 'timestamptz', name: 'published_at', default: () => 'NOW()' })
  publishedAt: Date;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
