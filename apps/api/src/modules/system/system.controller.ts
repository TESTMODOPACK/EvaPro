import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  UseGuards, ParseUUIDPipe, ParseIntPipe, DefaultValuePipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { SystemService } from './system.service';
import { ChangelogType } from './entities/system-changelog.entity';

@Controller('system')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class SystemController {
  constructor(private readonly systemService: SystemService) {}

  /** Public for all authenticated users — returns latest active changelog entries */
  @Get('changelog')
  getChangelog(
    @Query('limit', new DefaultValuePipe(5), ParseIntPipe) limit: number,
  ) {
    return this.systemService.getChangelog(Math.min(limit, 20));
  }

  /** Admin view — returns ALL changelog entries including inactive */
  @Get('changelog/all')
  @Roles('super_admin')
  getAllChangelog() {
    return this.systemService.getAllChangelog();
  }

  @Post('changelog')
  @Roles('super_admin')
  createChangelog(@Body() dto: { version: string; title: string; description: string; type?: ChangelogType }) {
    return this.systemService.createChangelog(dto);
  }

  @Patch('changelog/:id')
  @Roles('super_admin')
  updateChangelog(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: Partial<{ version: string; title: string; description: string; type: ChangelogType; isActive: boolean }>,
  ) {
    return this.systemService.updateChangelog(id, dto);
  }

  @Delete('changelog/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('super_admin')
  deleteChangelog(@Param('id', ParseUUIDPipe) id: string) {
    return this.systemService.deleteChangelog(id);
  }
}
