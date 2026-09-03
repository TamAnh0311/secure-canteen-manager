import { Sheet } from '../../sheet.entity';
import { VerifyService } from '../verify.service';
import { OperatorRole } from '../../../operators/operator.entity';
import { OperatorPublic } from '../../../operators/operator-public';

describe('VerifyService.getWarpedImage content type', () => {
  it('identifies a raw JPEG fallback when no ROI template is available', async () => {
    const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const sheet = { id: 'sheet-1', imagePath: 'raw-scan.jpg' } as Sheet;
    const service = Object.assign(Object.create(VerifyService.prototype), {
      sheetRepo: { findOne: jest.fn().mockResolvedValue(sheet) },
      thresholdConfig: {
        getRoi: jest.fn().mockResolvedValue({ roiTemplate: null, roiVersion: 'v3' }),
      },
      storage: {
        warpedImageExists: jest.fn().mockReturnValue(false),
        readImageAsBase64: jest.fn().mockReturnValue(jpegBytes.toString('base64')),
      },
      omrClient: { warpSheet: jest.fn() },
      logger: { error: jest.fn(), warn: jest.fn() },
      loadAuthorizedSheetOrThrow: jest.fn().mockResolvedValue(sheet),
    }) as VerifyService;

    const result = await service.getWarpedImage(
      sheet.id,
      { id: 'operator-1', role: OperatorRole.ADMIN, zone: null } as OperatorPublic,
    );

    expect(result).toEqual({ imageBytes: jpegBytes, warpOk: false, contentType: 'image/jpeg' });
    expect(service['omrClient'].warpSheet).not.toHaveBeenCalled();
  });
});
