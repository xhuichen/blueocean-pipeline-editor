// @flow

import React, { Component, PropTypes } from 'react';
import { EditorPipelineGraph } from './EditorPipelineGraph';
import { EditorStepList } from './EditorStepList';
import { EditorStepDetails } from './EditorStepDetails';
import { AgentConfiguration } from './AgentConfiguration';
import { EnvironmentConfiguration } from './EnvironmentConfiguration';
import { EmptyStateView } from '@jenkins-cd/design-language';
import { AddStepSelectionSheet } from './AddStepSelectionSheet';
import pipelineStore from '../../services/PipelineStore';
import type { StageInfo, StepInfo } from '../../services/PipelineStore';
import { Sheets } from '../Sheets';
import { MoreMenu } from '../MoreMenu';
import { Icon } from "@jenkins-cd/react-material-icons";
import pipelineValidator from '../../services/PipelineValidator';
import { ValidationMessageList } from './ValidationMessageList';

type Props = {
};

type State = {
    selectedStage: ?StageInfo,
    selectedSteps: StepInfo[],
    showSelectStep: ?boolean,
    parentStep: ?StepInfo,
};

type DefaultProps = typeof EditorMain.defaultProps;

function ConfigPanel({className, children}) {
    return (<div className={className}>
        {children}
    </div>);
}

export class EditorMain extends Component<DefaultProps, Props, State> {

    static defaultProps = {};

    //static propTypes = {...}
    // TODO: React proptypes ^^^

    props:Props;
    state:State;
    pipelineUpdated: Function;

    constructor() {
        super();
        this.state = { selectedSteps: [] };
    }

    componentWillMount() {
        pipelineStore.addListener(this.pipelineUpdated = p => this.doUpdate());
    }

    componentWillUnmount() {
        pipelineStore.removeListener(this.pipelineUpdated);
    }

    doUpdate() {
        if (this.state.selectedStage && !pipelineStore.findParentStage(this.state.selectedStage)) {
            this.setState({selectedStage: null});
        } else {
            this.forceUpdate();
        }
    }

    createStage(parentStage:StageInfo) {
        const newStage = parentStage
            ? pipelineStore.createParallelStage('', parentStage)
            : pipelineStore.createSequentialStage('');
        this.setState({
            selectedStage: newStage,
            selectedSteps: [],
        }, e => {
            setTimeout(() => {
                document.querySelector('.stage-name-edit').focus();
            }, 200);
        });
    }
    
    graphSelectedStageChanged(newSelectedStage:?StageInfo) {
        this.setState({
            selectedStage: newSelectedStage,
            selectedSteps: [],
            showSelectStep: false,
        });
    }

    openSelectStepDialog(parentStep: ?StepInfo = null) {
        this.setState({showSelectStep: true, parentStep: parentStep});
    }

    selectedStepChanged(step: StepInfo, parentStep: ?StepInfo) {
        let { selectedSteps } = this.state;
        if (!step) {
            selectedSteps.pop();
        } else {
            if (parentStep) {
                selectedSteps.push(step);
            } else {
                selectedSteps = [ step ];
            }
        }
        this.setState({selectedSteps, showSelectStep: false});
    }

    stepDataChanged(newStep:any) {
        this.forceUpdate();
    }

    addStep(step: any) {
        const { selectedSteps } = this.state;
        const newStep = pipelineStore.addStep(this.state.selectedStage, this.state.parentStep, step);
        selectedSteps.push(newStep);
        this.setState({showSelectStep: false, selectedSteps}, e => {
            setTimeout(() => {
                document.querySelector('.sheet:last-child .editor-step-detail input,.sheet:last-child .editor-step-detail textarea').focus();
            }, 200);
        });
    }

    deleteStep(step: any) {
        pipelineStore.deleteStep(step);
        this.state.selectedSteps.pop(); // FIXME
        this.setState({selectedSteps});
    }

    deleteStageClicked(e:HTMLEvent) {
        e.target.blur(); // Don't leave ugly selection highlight

        const {selectedStage} = this.state;

        if (selectedStage) {
            pipelineStore.deleteStage(selectedStage);
        }
    }

    validatePipeline() {
        pipelineValidator.validatePipeline(pipelineStore.pipeline, validationResult => {
            console.log(validationResult);
            pipelineValidator.applyValidationMarkers(pipelineStore.pipeline, validationResult);
            this.forceUpdate(); // redraw stuff with/without errors
        });
    }

    render() {
        const {selectedStage, selectedSteps} = this.state;
        const sheets = [];
        const steps = selectedStage ? selectedStage.steps : [];

        const title = selectedStage ? selectedStage.name : 'Select or create a pipeline stage';
        const disableIfNoSelection = selectedStage ? {} : {disabled: 'disabled'}; // TODO: Delete if we don't use this any more

        // FIXME - agents are defined at the top stage level, this will change
        let configurationStage = selectedStage && (pipelineStore.findParentStage(selectedStage) || selectedStage);
        if (pipelineStore.pipeline === configurationStage) {
            configurationStage = selectedStage;
        }

        const globalConfigPanel = pipelineStore.pipeline && (<ConfigPanel className="editor-config-panel global"
            key={'globalConfig'+pipelineStore.pipeline.id}
            title={<h4>
                    Pipeline Settings
                </h4>}>
            <AgentConfiguration key={'agent'+pipelineStore.pipeline.id} node={pipelineStore.pipeline} onChange={agent => (selectedStage && agent.type == 'none' ? delete pipelineStore.pipeline.agent : pipelineStore.pipeline.agent = agent) && this.pipelineUpdated()} />
            <EnvironmentConfiguration key={'env'+pipelineStore.pipeline.id} node={pipelineStore.pipeline} onChange={e => this.pipelineUpdated()} />
        </ConfigPanel>);

        if (globalConfigPanel) sheets.push(globalConfigPanel);

        const stageConfigPanel = selectedStage && (<ConfigPanel className="editor-config-panel stage" key={'stageConfig'+selectedStage.id}
            onClose={e => this.validatePipeline() || this.graphSelectedStageChanged(null)}
            title={
                <div>
                    <input className="stage-name-edit" placeholder="Name your stage" defaultValue={title} 
                        onChange={e => (selectedStage.name = e.target.value) && this.pipelineUpdated()} />
                    <MoreMenu>
                        <a onClick={e => this.deleteStageClicked(e)}>Delete</a>
                    </MoreMenu>
                </div>
            }>
            <ValidationMessageList node={selectedStage} />
            <EditorStepList steps={steps}
                        onAddStepClick={() => this.openSelectStepDialog()}
                        onAddChildStepClick={parent => this.openSelectStepDialog(parent)}
                        onStepSelected={(step) => this.selectedStepChanged(step)} />
            {/*
            <AgentConfiguration key={'agent'+configurationStage.id} node={configurationStage} onChange={agent => (selectedStage && agent.type == 'none' ? delete configurationStage.agent : configurationStage.agent = agent) && this.pipelineUpdated()} />
            <EnvironmentConfiguration key={'env'+configurationStage.id} node={configurationStage} onChange={e => this.pipelineUpdated()} />
            */}
        </ConfigPanel>);

        if (stageConfigPanel) sheets.push(stageConfigPanel);

        let parentStep = null;
        for (const step of selectedSteps) {
            const stepConfigPanel = (<EditorStepDetails className="editor-config-panel step"
                    step={step} key={steps.indexOf(step)}
                    onDataChange={newValue => this.stepDataChanged(newValue)}
                    onClose={e => this.validatePipeline() || this.selectedStepChanged(null, parentStep)}
                    openSelectStepDialog={step => this.openSelectStepDialog(step)}
                    selectedStepChanged={step => this.selectedStepChanged(step, parentStep)}
                    title={<h4>
                        {selectedStage && selectedStage.name} / {step.label}
                        <MoreMenu>
                            <a onClick={e => this.deleteStep(step)}>Delete</a>
                        </MoreMenu>
                    </h4>} />);

            if (stepConfigPanel) sheets.push(stepConfigPanel);
            parentStep = step;
        }

        const stepAddPanel = this.state.showSelectStep && (<AddStepSelectionSheet
                onClose={() => this.setState({showSelectStep: false})}
                onStepSelected={step => this.addStep(step)}
                title={<h4>Choose step type</h4>} />);

        if (stepAddPanel) sheets.push(stepAddPanel);

        return (
            <div className="editor-main" key={pipelineStore.pipeline && pipelineStore.pipeline.id}>
                <div className="editor-main-graph" onClick={e => this.validatePipeline() || this.setState({selectedStage: null, selectedSteps: []})}>
                    {pipelineStore.pipeline &&
                    <EditorPipelineGraph stages={pipelineStore.pipeline.children}
                                         selectedStage={selectedStage}
                                         onStageSelected={(stage) => this.graphSelectedStageChanged(stage)}
                                         onCreateStage={(parentStage) => this.createStage(parentStage)}/>
                    }
                </div>
                <Sheets>
                {sheets}
                </Sheets>
            </div>
        );
    }
}
