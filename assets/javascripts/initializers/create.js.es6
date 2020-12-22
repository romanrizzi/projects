import { withPluginApi } from "discourse/lib/plugin-api";
import { default as computed, observes, on } from 'ember-addons/ember-computed-decorators';
import Composer from 'discourse/models/composer';
import debounce from "discourse/plugins/projects/lib/debounce";
import { later } from "@ember/runloop";
import { bed_block_format, begin_format,duration_format,end_format } from '../discourse/lib/utils'
import { once } from "@ember/runloop";
import Category from "discourse/models/category";
function initializeComposer(api) {
  //DRAFT
  //TODO on composer open also fire dry to get messages
  Composer.serializeToDraft('projects_task');
  Composer.reopen({
    setupProjectsTask(){
      if(!this.category || !this.category.projects_enabled){return;}
      //no draft
      if(!this.projects_task){
        let draft_projects_task = {}
        if(!this.topic) { //CREATE
          draft_projects_task.id = "drycreate"
          draft_projects_task.dry = true
          draft_projects_task.locked = "duration"
          draft_projects_task.begin = ""
          draft_projects_task.duration = ""
          draft_projects_task.end = ""
          draft_projects_task.modified = "duration"
          draft_projects_task.depon = []
          draft_projects_task.depby = []
          draft_projects_task.categoryId = this.categoryId

        } else { //EDIT
          draft_projects_task = Object.assign({}, this.topic.projects_task);
          draft_projects_task.id = this.topic.id;
        }
        this.set('projects_task',draft_projects_task)
        }
      //shoot dry on composer open to display messages
      this.set('projects_task.dry', true );
      this.save_projects_task()

    },
    @observes('composerOpened')
    composeinit(){
      if(this.composerOpened == null) return;
      once(this, "setupProjectsTask")
    },
    //https://github.com/discourse/discourse/blob/master/app/assets/javascripts/discourse/models/composer.js.es6#L1165
    @observes('projects_task.begin',
              'projects_task.end',
              'projects_task.duration','projects_task.locked',
              'projects_task.modified','projects_task.depon.[]',
              'projects_task.depby.[]','projects_task.dry','projects_task.disallow')
    ptdataChanged() {
      const draftStatus = this.draftStatus;
      if (draftStatus && !this._clearingStatus) {
        this._clearingStatus = later(
          this,
          () => {
            this.setProperties({ draftStatus: null, draftConflictUser: null });
            this._clearingStatus = null;
            this.setProperties({ draftSaving: false, draftSaved: false });
          },
          Ember.Test ? 0 : 1000
        );
      }
    },
    @computed('projects_task.disallow')
    disallow_classes(disallow) {
     if (disallow){
       return "locked-btn small-btn btn-primary"
     } else {
       return "small-btn btn-primary"
     }
    },
    @computed('projects_task.locked',
          'projects_task.duration',
          'projects_task.begin',
          'projects_task.end')
    closed(locked, duration, begin, end) {
      if (locked === "begin" && duration && end ) {
            return "begin"
      } else if (locked === "end" && duration && begin ) {
            return "end"
      } else if (locked === "duration" && begin  && end  ) {
            return "duration"
      } else {
            return ""
      }
    },
    //TODO: this should become a component
    create_composer_messages(result){
      let mhtml = ""
      const messis = result.payload.messages
      Object.keys(messis).forEach((i) => {
        mhtml += `<div><h4><a href=${messis[i][0].url}>${messis[i][0].title}</a>
        ${bed_block_format(messis[i][0].begin,messis[i][0].duration,messis[i][0].end)}
        </h4><ul class="pt_messages">`
        messis[i].forEach((m, i) => {
          if(m.message_type == "error"){result.payload.pt_error = true}
          if(m.message_type != "changes"){mhtml+=`<li class="${m.message_type}">${m.message}</li>`}
          else{
            let message =""
            if(m.begin_from){
              message = m.begin_to?`will change begin from <b>${begin_format(m.begin_from)}</b> to <b>${begin_format(m.begin_to)}</b>`:'will unset begin'
            }
            else if(m.end_from){
              message = m.end_to?`will change end from <b>${end_format(m.end_from)}</b> to <b>${end_format(m.end_to)}</b>`:'will unset end'
            }
            else if(m.duration_from){
              message = m.duration_to?`will change duration from <b>${duration_format(m.duration_from)}</b> to <b>${duration_format(m.duration_to)}</b>`:'will unset duration'
            }
            else if(m.begin_to){
              message = `will set begin to <b>${begin_format(m.begin_to)}</b>`
            }
            else if(m.end_to){
              message = `will set end to <b>${end_format(m.end_to)}</b>`
            }
            else if(m.duration_to){
              message = `will set duration to <b>${duration_format(m.duration_to)}</b>`
            }
            else {
              message = JSON.stringify(m)
            }
            mhtml+=`<li class="${m.message_type}">${message}</li>`}
        });
        mhtml +="</ul></div>"
      });

         const body = mhtml
         result.target.appEvents.trigger("composer-messages:create", {
           extraClass: "custom-body",
           templateName: "custom-body",
           body
         });
    },
    save_projects_task(){
           const noteRecord = this.store.createRecord('note', this.projects_task);
           return noteRecord.save().then(function(result) {
                this.create_composer_messages(result);
                //refresh topic
                result.target.appEvents.trigger("post-stream:refresh", {
                  id: parseInt(result.responseJson.id, 10)
                });
                //refresh category
                  Category.reloadById(this.categoryId).then(atts => {
                       const model = this.store.createRecord("category", atts.category);
                       model.setupGroupsAndPermissions();
                       this.site.updateCategory(model);
                  });
                //set projects_task on composer
                this.set("projects_task", result.payload);
                if(!this.projects_task.begin){this.set("projects_task.begin",  "") }
                if(!this.projects_task.duration){this.set("projects_task.duration",  "") }
                if(!this.projects_task.end){this.set("projects_task.end",  "") }
           if(result.payload.pt_error){return Promise.reject("handled")}
           return Promise.resolve();

         }.bind(this)).catch(function(err){

           if(err != "handled"){
           console.log(err)

              const body = "an error has occured. please retry"
              this.appEvents.trigger("composer-messages:create",
              {extraClass: "custom-body",templateName: "custom-body", body});
            }
          return Promise.reject()

          }.bind(this));

      },


    });

  //CREATE
//we can work with this: second arg gives us begin,time pr_t_att etc
//          this.appEvents.trigger("topic:created", createdPost, composer);
  api.onAppEvent('topic:created', function(createdPost,composer){
    if(!composer.category || !composer.category.projects_enabled){return;}
       composer.projects_task.id = createdPost.topic_id;
       composer.projects_task.dry=false;
       composer.save_projects_task();
     });
//UPDATE
//this.begin time pr_t_att etc is all there
//also:this.action: "edit" and this.topic.id
//topic.currentPost: 1
 api.composerBeforeSave(function() {
   if(!this.category || !this.category.projects_enabled){return Promise.resolve();}
   if (this.action == 'edit') {
     this.set('projects_task.id',this.topic.id);
     this.set('projects_task.dry',false);
     return this.save_projects_task();
    }
    return Promise.resolve();
 });


  api.modifyClass("controller:composer", {
//https://github.com/discourse/discourse/blob/master/app/assets/javascripts/discourse/controllers/composer.js.es6#L1075
  @observes('model.projects_task.begin',
            'model.projects_task.end',
            'model.projects_task.duration','model.projects_task.locked',
            'model.projects_task.modified','model.projects_task.depon.[]',
            'model.projects_task.depby.[]','model.projects_task.dry','model.projects_task.disallow')
  _ptshouldSaveDraft() {
    debounce(this, this._saveDraft, 2000);
  },



  });
}
export default {
  name: "composerChanges",

  initialize() {


    withPluginApi("0.8.31", initializeComposer);
  }
};
