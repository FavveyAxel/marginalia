import { Composition } from 'remotion';
import { Presentation, FPS, DURATION } from './Presentation';

export const Root = () => <Composition id="Presentation" component={Presentation} durationInFrames={DURATION} fps={FPS} width={1920} height={1080} />;
