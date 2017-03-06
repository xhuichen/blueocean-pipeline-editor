import React from 'react';
import { Link } from 'react-router';
import { PipelineEditor } from './PipelineEditor';
import {
        Fetch, getRestUrl, buildPipelineUrl, capabilityAugmenter, locationService,
        ContentPageHeader, UrlConfig, Utils, pipelineService, AppConfig, Paths,
    } from '@jenkins-cd/blueocean-core-js';
import {
    Dialog,
    TextArea,
    RadioButtonGroup,
    TextInput,
    FormElement,
} from '@jenkins-cd/design-language';
import { convertInternalModelToJson, convertJsonToPipeline, convertPipelineToJson, convertJsonToInternalModel } from './services/PipelineSyntaxConverter';
import pipelineValidator from './services/PipelineValidator';
import pipelineStore from './services/PipelineStore';
import { observer } from 'mobx-react';
import { observable, action } from 'mobx';
import saveApi from './SaveApi';

const Base64 = { encode: (data) => btoa(data), decode: (str) => atob(str) };

class SaveDialog extends React.Component {
    constructor(props) {
        super(props);
        const { branch } = this.props;
        this.state = { branch: branch };
        this.branchOptions = [
           { branch: branch, toString: () => `Commit to ${branch}`},
           { branch: '', toString: () => `Commit to new branch`},
       ];
    }
    
    save() {
        this.setState({ saving: true });
        this.props.save(this.state.branch, this.state.commitMessage);
    }
    
    cancel() {
        if (!this.state.saving) {
            this.props.cancel();
        }
    }

    render() {
        const { branch } = this.props;
        
        const buttons = [
            <button className="btn-primary" onClick={() => this.save()} disabled={this.state.saving}>Save & run</button>,
            <button className="btn-link btn-secondary" disabled={this.state.saving} onClick={() => cancel()}>Cancel</button>,
        ];
        
        return (
            <Dialog onDismiss={() => cancel()} title="Save Pipeline" buttons={buttons} className="save-pipeline-dialog">
                <div>Saving the pipeline will commit a Jenkinsfile to the repository</div>
                <FormElement title="Description">
                    <TextArea placeholder="What changed?" defaultValue="" width="100%" cols={2} disabled={this.state.saving}
                        onChange={value => this.setState({commitMessage: value})} />
                </FormElement>
                <RadioButtonGroup options={this.branchOptions} defaultOption={this.branchOptions[0]}
                    onChange={o => this.setState({branch: o.branch})} disabled={this.state.saving} />
                <div className="indent-form">
                <FormElement className="customBranch">
                    <TextInput placeholder="my-new-branch" onChange={value => this.setState({branch: this.branchOptions[1].branch = value})}
                        disabled={this.state.branch !== this.branchOptions[1].branch || this.state.saving} />
                </FormElement>
                </div>
            </Dialog>
        );
    }
}

@observer
class PipelineLoader extends React.Component {
    state = {}
    
    componentWillMount() {
        const { organization, pipeline, branch } = this.props.params;
        this.opener = locationService.previous;
        
        Fetch.fetchJSON(`${getRestUrl(this.props.params)}scm/content/?branch=${encodeURIComponent(branch)}&path=Jenkinsfile`)
        .then( ({ content }) => {
            const pipelineScript = Base64.decode(content.base64Data);
            this.setState({pipelineScript, sha: content.sha});
        })
        .catch(err => {
            this.setState({pipelineScript: `
pipeline {
  agent any
  stages {
    stage('Build') {
      steps {
        echo 'hello'
      }
    }
    stage('Test') {
      steps {
        parallel(
          "Chrome": {
            echo 'testing in chrome'
            
          },
          "Firefox": {
            echo 'testing in firefox'
            
          }
        )
      }
    }
    stage('Deploy') {
      steps {
        echo 'deploying'
      }
    }
  }
}            
            `});
            console.log(err);
            if (err.response.status != 404) {
                this.showErrorDialog(err.message);
            }
        });
        
        this.href = Paths.rest.pipeline(organization, pipeline);
        pipelineService.fetchPipeline(this.href, { useCache: true })
        .catch(err => {
            console.log(err);
            // No pipeline, use org folder
            const team = pipeline.split('/')[0];
            this.href = Paths.rest.pipeline(organization, team);
            pipelineService.fetchPipeline(this.href, { useCache: true })
        });
    }

    cancel() {
        const { organization, pipeline, branch } = this.props.params;
        const { router } = this.context;
        const location = {};
        location.pathname = branch == null ? '/' : buildPipelineUrl(organization, pipeline);
        location.query = null;
        
        if (this.opener) {
            router.goBack();
        } else {
            router.push(location);
        }
    }
    
    goToActivity() {
        const { organization, pipeline, branch } = this.props.params;
        const { router } = this.context;
        const location = buildPipelineUrl(organization, pipeline);
        router.push(location);
    }
    
    closeDialog() {
        this.setState({ dialog: null });
    }
    
    showErrorDialog(errorMessage) {
        const buttons = [
            <button className="btn-primary" onClick={() => this.closeDialog()}>Ok</button>,
        ];
         
        this.setState({ dialog: (
            <Dialog onDismiss={() => this.closeDialog()} title="Error" buttons={buttons}>
                {errorMessage}
            </Dialog>
        )});
    }
    
    showSaveDialog() {
        pipelineValidator.validate(err => {
            if (!pipelineValidator.hasValidationErrors(pipelineStore.pipeline)) {
                this.setState({showSaveDialog: true});
            } else {
                this.showErrorDialog("There are validation errors, please check the pipeline.");
            }
        });
    }
    
    save(branch, commitMessage) {
        const { organization, pipeline } = this.props.params;
        const pipelineJson = convertInternalModelToJson(pipelineStore.pipeline);
        const split = pipeline.split('/');
        const team = split[0];
        const repo = split[1];
        convertJsonToPipeline(JSON.stringify(pipelineJson), (pipelineScript, err) => {
            if (!err) {
                const pipelineObj = this.getPipeline();
                Fetch.fetchJSON(`${getRestUrl({organization:organization, pipeline: team})}scm/content/`, {
                    fetchOptions: {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            "$class" : "io.jenkins.blueocean.blueocean_github_pipeline.GithubScmSaveFileRequest",
                            "content" : {
                              "message" : commitMessage,
                              "path" : "Jenkinsfile",
                              branch: branch || 'master',
                              repo: repo,
                              "sha" : this.state.sha,
                              "base64Data" : Base64.encode(pipelineScript),
                            }
                        }),
                    }
                })
                .then(data => {
                    this.setState({ sha: data.sha });
                    saveApi.index(organization, team, () => this.goToActivity());
                })
                .catch(ex => {
                    // TODO error messages, check for invalid credentials
                    console.log(ex);
                    this.showErrorDialog(ex.message);
                });
            } else {
                this.showErrorDialog(err);
            }
        });
    }

    getPipeline() {
        const pipeline = pipelineService.getPipeline(this.href);
        return pipeline;
    }
    
    render() {
        const { branch } = this.props.params;
        const { pipelineScript } = this.state;
        const pipeline = this.getPipeline();
        const repo = this.props.params.pipeline.split('/')[1];
        return <div className="pipeline-page">
            <ContentPageHeader>
                <div className="u-flex-grow">
                    <h1>
                        {pipeline && (decodeURIComponent(pipeline.fullDisplayName.replace('/', ' / ')) + ' / ' + (branch || repo))}
                    </h1>
                </div>
                <div className="editor-page-header-controls">
                    <button className="btn-link inverse" onClick={() => this.cancel()}>Cancel</button>
                    <button className="btn-primary inverse" onClick={() => this.showSaveDialog()}>Save</button>
                </div>
            </ContentPageHeader>
            <PipelineEditor pipeline={pipelineScript}/>
            {this.state.dialog}
            {this.state.showSaveDialog && <SaveDialog branch={branch || 'master'}
                cancel={() => this.setState({showSaveDialog: false})}
                save={(branch, commitMessage) => this.save(branch, commitMessage)} />
            }
        </div>;
    }
}

PipelineLoader.contextTypes = {
    router: React.PropTypes.object,
    location: React.PropTypes.object,
};

export const EditorPage = PipelineLoader;