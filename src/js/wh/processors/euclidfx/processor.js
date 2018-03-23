import createMIDIProcessorBase from '../../midi/processorbase';
import { PPQN } from '../../core/config';
import { getEuclidPattern, rotateEuclidPattern } from './euclid';

export function createProcessor(specs, my) {
    let that,
        store = specs.store,
        position = 0,
        duration = 0,
        stepDuration = 0,
        euclidPattern = [],
        params = {},
        delayedEvents = [];

    const initialize = function() {
            document.addEventListener(store.STATE_CHANGE, handleStateChanges);
            updateParams(specs.data.params.byId);
            updateEffectSettings();
            updatePattern(true);
        },

        terminate = function() {
            document.removeEventListener(store.STATE_CHANGE, handleStateChanges);
        },

        handleStateChanges = function(e) {
            switch (e.detail.action.type) {
                case e.detail.actions.CHANGE_PARAMETER:
                    if (e.detail.action.processorID === my.id) {
                        my.params = e.detail.state.processors.byId[my.id].params.byId;
                        switch (e.detail.action.paramKey) {
                            case 'steps':
                                updatePulsesAndRotation();
                                updatePattern(true);
                                break;
                            case 'pulses':
                                updatePattern(true);
                                break;
                            case 'rotation':
                            case 'is_triplets':
                            case 'rate':
                                updatePattern();
                                break;
                            case 'low':
                            case 'high':
                                updateParams(e.detail.state.processors.byId[my.id].params.byId);
                                break;
                            case 'target':
                                updateParams(e.detail.state.processors.byId[my.id].params.byId);
                                updateEffectSettings();
                                break;
                            case 'mode':
                                updateParams(e.detail.state.processors.byId[my.id].params.byId);
                                updateEffectSettings();
                                break;
                        }
                    }
                    break;

                case e.detail.actions.RECREATE_PARAMETER:
                    if (e.detail.action.processorID === my.id) {
                        updateParams(e.detail.state.processors.byId[my.id].params.byId);
                    }
                    break;
            }
        },
            
        /**
         * Process events to happen in a time slice. This will
         * - Get events waiting at the input
         * - Process them according to the current parameter settings.
         * - Send the processed events to the output.
         * - Add the events to the processorEvents parameter for display in the view.
         * 
         * Events are plain objects with properties:
         * @param {String} type 'note'
         * @param {Number} timestampTicks Event start time, measured from timeline start
         * @param {Number} durationTicks
         * @param {Number} channel 1 - 16
         * @param {Number} velocity 0 - 127
         * @param {Number} pitch 0 - 127
         * 
         * This method's parameters:
         * @param {Number} scanStart Timespan start in ticks from timeline start.
         * @param {Number} scanEnd   Timespan end in ticks from timeline start.
         * @param {Number} nowToScanStart Timespan from current timeline position to scanStart, in ticks
         * @param {Number} ticksToMsMultiplier Duration of one tick in milliseconds.
         * @param {Number} offset Time from doc start to timeline start in ticks.
         * @param {Array} processorEvents Array to collect processor generated events to display in the view.
         */
        process = function(scanStart, scanEnd, nowToScanStart, ticksToMsMultiplier, offset, processorEvents) {
            
            // clear the output event stack
            my.clearOutputData();

            // retrieve events waiting at the processor's input
            const inputData = my.getInputData();

            // abort if there's nothing to process
            if (inputData.length === 0) {
                processDelayedEvents(scanStart, scanEnd);
                return;
            }

            // calculate the processed timespan's position within the pattern, 
            // taking into account the pattern looping during this timespan.
            var localScanStart = scanStart % duration,
                localScanEnd = scanEnd % duration,
                localScanStart2 = false,
                localScanEnd2;
            if (localScanStart > localScanEnd) {
                localScanStart2 = 0,
                localScanEnd2 = localScanEnd;
                localScanEnd = duration;
            }

            for (let i = 0, n = inputData.length; i < n; i++) {
                const event = inputData[i];

                let isDelayed = false;

                // handle only MIDI Note events
                if (event.type === 'note') {

                    // calculate the state of the effect at the event's time within the pattern
                    const stepIndex = Math.floor((event.timestampTicks % duration) / stepDuration),
                        state = euclidPattern[stepIndex],
                        effectValue = state ? params.high : params.low;
                    
                    // apply the effect to the event's target parameter
                    switch (params.target) {
                        case 'velocity':
                            event.velocity = params.isRelative ? event.velocity + effectValue : effectValue;
                            event.velocity = Math.max(0, Math.min(event.velocity, 127));
                            break;
                        case 'pitch':
                            event.pitch = params.isRelative ? event.pitch + effectValue : effectValue;
                            event.pitch = Math.max(0, Math.min(event.pitch, 127));
                            break;
                        case 'channel':
                            event.channel = params.isRelative ? event.channel + effectValue : effectValue;
                            event.channel = Math.max(1, Math.min(event.channel, 16));
                            break;
                        case 'length':
                            const valueInTicks = (effectValue / 32) * PPQN * 4; // max 32 = 1 measure = PPQN * 4
                            event.durationTicks = params.isRelative ? event.durationTicks + valueInTicks : valueInTicks;
                            event.durationTicks = Math.max(1, event.durationTicks);
                            break;
                        case 'delay':
                            if (effectValue > 0) {
                                const delayInTicks = Math.max(0, (effectValue / 32) * PPQN * 4); // 32 = 1 measure = PPQN * 4
                                console.log(delayInTicks);
                                // store note if delayed start time falls outside of the current scanrange
                                if (event.timestampTicks + delayInTicks > scanEnd) {
                                    delayedEvents.push({
                                        ...event,
                                        timestampTicks: event.timestampTicks + delayInTicks
                                    });
                                    isDelayed = true;
                                } else {
                                    event.timestampTicks = event.timestampTicks + delayInTicks;
                                }
                            }
                            break;
                        case 'output':
                            // v2.2
                            break;
                    }

                    // add events to processorEvents for the canvas to show them
                    if (!processorEvents[my.id]) {
                        processorEvents[my.id] = [];
                    }
                    
                    const delayFromNowToNoteStart = (event.timestampTicks - scanStart) * ticksToMsMultiplier;
                    processorEvents[my.id].push({
                        stepIndex: stepIndex,
                        delayFromNowToNoteStart: delayFromNowToNoteStart,
                        delayFromNowToNoteEnd: delayFromNowToNoteStart + (event.durationTicks * ticksToMsMultiplier)
                    });

                    // push the event to the processor's output
                    if (!isDelayed) {
                        my.setOutputData(event);
                    }
                }
            }

            processDelayedEvents(scanStart, scanEnd);
        },
            
        /**
         * Check if stored delayed events 
         * @param {Number} scanStart Timespan start in ticks from timeline start.
         * @param {Number} scanEnd   Timespan end in ticks from timeline start.
         */
        processDelayedEvents = function(scanStart, scanEnd) {
            // console.log('d', scanStart, scanEnd);
            var i = delayedEvents.length;
            while (--i > -1) {
                const timestampTicks = delayedEvents[i].timestampTicks;
                // console.log('e', timestampTicks);
                if (scanStart <= timestampTicks && scanEnd > timestampTicks) {
                    my.setOutputData(delayedEvents.splice(i, 1));
                }
            }
        },

        /**
         * After a change of the steps parameter update the pulses and rotation parameters.
         */
        updatePulsesAndRotation = function() {
            store.dispatch(store.getActions().recreateParameter(my.id, 'pulses', { max: my.params.steps.value }));
            store.dispatch(store.getActions().recreateParameter(my.id, 'rotation', { max: my.params.steps.value - 1 }));
            store.dispatch(store.getActions().changeParameter(my.id, 'pulses', my.params.pulses.value));
            store.dispatch(store.getActions().changeParameter(my.id, 'rotation', my.params.rotation.value));
        },
            
        /**
         * Update all pattern properties.
         * @param {Boolean} isEuclidChange Steps, pulses or rotation change.
         */
        updatePattern = function(isEuclidChange) {
            // euclidean pattern properties, changes in steps, pulses, rotation
            if (isEuclidChange) {
                euclidPattern = getEuclidPattern(my.params.steps.value, my.params.pulses.value);
                euclidPattern = rotateEuclidPattern(euclidPattern, my.params.rotation.value);
            }
            
            // playback properties, changes in isTriplets and rate
            var rate = my.params.is_triplets.value ? my.params.rate.value * (2 / 3) : my.params.rate.value;
            stepDuration = rate * PPQN;
            duration = my.params.steps.value * stepDuration;
        },

        updateParams = function(parameters) {
            params.high = parameters.high.value;
            params.low = parameters.low.value;
            params.target = parameters.target.value;
            params.isRelative = parameters.mode.value !== parameters.mode.default;
        },
        
        updateEffectSettings = function() {
            let min, max, lowValue, highValue;

            // set minimum and maximum value according to target type
            switch (params.target) {
                case 'velocity':
                    min = params.isRelative ? -127 : 0;
                    max = 127;
                    lowValue = params.isRelative ? 0 : 50;
                    highValue = params.isRelative ? 0 : 100;
                    break;
                case 'pitch':
                    min = params.isRelative ? -127 : 0;
                    max = 127;
                    lowValue = params.isRelative ? 0 : 58;
                    highValue = params.isRelative ? 0 : 60;
                    break;
                case 'channel':
                    min = params.isRelative ? -16 : 1;
                    max = 16;
                    lowValue = params.isRelative ? 0 : 1;
                    highValue = params.isRelative ? 0 : 2;
                    break;
                case 'length':
                    min = params.isRelative ? -32 : 0;
                    max = 32;
                    lowValue = params.isRelative ? 0 : 4;
                    highValue = params.isRelative ? 0 : 8;
                    break;
                case 'delay':
                    min = params.isRelative ? 0 : 0;
                    max = 32;
                    lowValue = params.isRelative ? 0 : 0;
                    highValue = params.isRelative ? 0 : 2;
                    break;
                case 'output':
                    min = 1;
                    max = 2;
                    lowValue = 1;
                    highValue = 2;
                    break;
            }

            // clamp parameter's value between minimum and maximum value
            lowValue = Math.max(min, Math.min(lowValue, max));
            highValue = Math.max(min, Math.min(highValue, max));

            // apply all new settings to the effect parameters 
            store.dispatch(store.getActions().recreateParameter(my.id, 'low', { min: min, max: max, value: lowValue }));
            store.dispatch(store.getActions().recreateParameter(my.id, 'high', { min: min, max: max, value: highValue }));
        };

    my = my || {};
    
    that = createMIDIProcessorBase(specs, my);

    initialize();

    that.terminate = terminate;
    that.process = process;
    return that;
}
